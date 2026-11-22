// Parses T&T Supermarket search-result text (as returned by TinyFish Fetch)
// into structured products. The text comes back either one field per line or
// all run together, e.g.
//   -24%Superior Natural Firm Tofu (454g)$1.97$2.59San Sui Firm Tofu (454g)$2.39
//   Baby Bok Choy Sum (~1.5lb)\n\n$1.68\n\n/lb\n\n$2.40/lb
// Shape per product: [-NN%] name [(size)] [Available: …] $price [/lb] [$wasPrice[/lb]]

const PRICE_RE = /\$(\d{1,4}(?:,\d{3})*\.\d{2})(\s*\/\s*lb)?/g;
const PRODUCT_URL_RE = /^https:\/\/www\.tntsupermarket\.com\/eng\/\d{6,}-[^/?#]+\.html$/;
const PRODUCT_IMG_RE = /\/media\/catalog\/product\//;
const NO_RESULTS_RE = /couldn['’]t find any products/i;
const LB_IN_G = 453.592;

const SIZE_RE = /(?:(\d+)\s*[x×]\s*)?(~)?\s*(\d+(?:\.\d+)?)\s*(kg|g|lbs?|ml|l|pcs?|pk|pack|bunch(?:es)?|ea|ct|count|s)(?![a-z])/gi;

/** Parse the last size in a product name: "(20x25g)" → {amount: 500, unit: "g"}. */
export function parseSize(name) {
  const bracketed = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]).reverse();
  const candidates = bracketed.length ? bracketed : [name];
  for (const text of candidates) {
    const matches = [...text.matchAll(SIZE_RE)];
    // Bare "s" only counts inside brackets like "(12s)", never in free text.
    const m = matches.reverse().find((x) => x[4].toLowerCase() !== "s" || bracketed.length);
    if (!m) continue;
    const multi = m[1] ? Number(m[1]) : 1;
    const n = Number(m[3]) * multi;
    const unit = m[4].toLowerCase();
    const approx = Boolean(m[2]);
    const label = m[0].trim();
    if (unit === "kg") return { amount: n * 1000, unit: "g", approx, label };
    if (unit === "g") return { amount: n, unit: "g", approx, label };
    if (unit.startsWith("lb")) return { amount: Math.round(n * LB_IN_G), unit: "g", approx, label };
    if (unit === "ml") return { amount: n, unit: "ml", approx, label };
    if (unit === "l") return { amount: n * 1000, unit: "ml", approx, label };
    return { amount: n, unit: "count", approx, label };
  }
  return null;
}

const money = (s) => Number(s.replace(/,/g, ""));

/**
 * @param {{text: string, links?: string[], images?: string[]}} page
 * @returns {{products: object[], linked: boolean, empty: boolean}}
 */
export function parseSearch({ text = "", links = [], images = [] }) {
  if (NO_RESULTS_RE.test(text)) return { products: [], linked: true, empty: true };

  let body = text.replace(/\s*\n\s*/g, "");
  const start = body.search(/Search results\s*"[^"]*"/);
  if (start >= 0) body = body.slice(start).replace(/^Search results\s*"[^"]*"/, "");
  const end = body.search(/Oops!|you['’]ve reached my bottom line/);
  if (end >= 0) body = body.slice(0, end);
  // Multi-buy promos ("2 for $7.97View") belong to the product before them.
  // Swap them for a marker without "$" so they aren't read as a price.
  // The deal count starts right after a full price ("$7.99" + "2 for"), so
  // anchor on the price's two decimals instead of letting it eat price digits.
  body = body.replace(/(?<=\.\d{2}(?:\s*\/\s*lb)?|^|[^\d.$])(\d{1,2})\s*for\s*\$(\d+\.\d{2})\s*(?:View)?/gi, "⟦DEAL:$1:$2⟧");

  const products = [];
  let last = 0;
  let prev = null;
  for (const m of body.matchAll(PRICE_RE)) {
    let segment = body.slice(last, m.index).trim();
    last = m.index + m[0].length;
    const deal = segment.match(/^⟦DEAL:(\d+):([\d.]+)⟧/);
    if (deal) {
      if (prev) prev.deal = { quantity: Number(deal[1]), price: Number(deal[2]) };
      segment = segment.slice(deal[0].length).trim();
    }
    segment = segment.replace(/⟦DEAL:[^⟧]*⟧/g, "").trim();
    const price = money(m[1]);
    const perLb = Boolean(m[2]);

    if (!segment) {
      // A price straight after a price is the original (pre-sale) price.
      if (prev && prev.wasPrice == null) prev.wasPrice = price;
      continue;
    }
    let name = segment;
    let discountPct = null;
    const disc = name.match(/^-(\d{1,2})%/);
    if (disc) {
      discountPct = Number(disc[1]);
      name = name.slice(disc[0].length).trim();
    }
    let note = null;
    const avail = name.match(/\s*Available:\s*(.*)$/i);
    if (avail) {
      note = `Available: ${avail[1].trim()}`;
      name = name.slice(0, avail.index).trim();
    }
    if (!name) continue;
    prev = { name, price, wasPrice: null, perLb, discountPct, note, deal: null, size: parseSize(name), url: null, image: null };
    products.push(prev);
  }

  const urls = [...new Set(links.filter((l) => PRODUCT_URL_RE.test(l)))];
  const imgs = images.filter((l) => PRODUCT_IMG_RE.test(l));
  let linked = urls.length === products.length;
  if (linked) {
    products.forEach((p, i) => {
      p.url = urls[i];
      p.image = imgs.length === products.length ? imgs[i] : null;
    });
  } else {
    linked = pairBySlug(products, urls);
  }
  return { products, linked, empty: products.length === 0 };
}

const slugWords = (url) =>
  new Set(url.replace(/^.*\/eng\/\d+-/, "").replace(/\.html$/, "").split("-").filter((w) => w.length > 1));
const nameWords = (name) =>
  name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * How well a link's slug fits a product name: share of slug words found in the
 * name (must be ≥ 0.6), plus half the share of name words found in the slug so
 * "superior-firm-tofu" prefers "Superior Natural Firm Tofu" over
 * "Superior Natural Medium Firm Tofu". Returns 0 when it doesn't fit.
 */
function slugRatio(slug, name) {
  const nw = nameWords(name);
  const has = (set, w) => set.has(w) || set.has(w + "s") || set.has(w.replace(/s$/, ""));
  const nSet = new Set(nw);
  const slugHits = [...slug].filter((w) => has(nSet, w)).length;
  const slugShare = slugHits / Math.max(slug.size, 1);
  if (slugShare < 0.6) return 0;
  const nameShare = nw.filter((w) => has(slug, w)).length / Math.max(nw.length, 1);
  return slugShare + 0.5 * nameShare;
}

/**
 * Fallback when counts differ: pair products and links by how much of the
 * link's slug appears in the product name, strongest pairs first. A pair is
 * only made when it is unambiguous among the still-unpaired products and
 * links; anything ambiguous keeps url: null (a missing link is safe, a wrong
 * one would put the wrong item in the cart).
 */
function pairBySlug(products, urls) {
  const links = urls.map((u) => ({ u, w: slugWords(u) }));
  const ratio = links.map((l) => products.map((p) => slugRatio(l.w, p.name)));
  const freeL = new Set(links.keys());
  const freeP = new Set(products.keys());
  for (let progress = true; progress; ) {
    progress = false;
    const pairs = [];
    for (const li of freeL) for (const pi of freeP) if (ratio[li][pi] > 0) pairs.push([ratio[li][pi], li, pi]);
    pairs.sort((a, b) => b[0] - a[0]);
    for (const [r, li, pi] of pairs) {
      if (!freeL.has(li) || !freeP.has(pi)) continue;
      const rivalP = [...freeP].some((q) => q !== pi && ratio[li][q] >= r);
      const rivalL = [...freeL].some((m) => m !== li && ratio[m][pi] >= r);
      if (rivalP || rivalL) continue;
      products[pi].url = links[li].u;
      freeL.delete(li);
      freeP.delete(pi);
      progress = true;
    }
  }
  return freeP.size === 0;
}

export const searchUrl = (query) =>
  `https://www.tntsupermarket.com/eng/search.html?query=${encodeURIComponent(query)}`;
