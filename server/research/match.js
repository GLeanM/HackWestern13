// Picks the best T&T product for a shopping-list item: relevant name, safe for
// the user's allergies / avoid list / diet, and the cheapest way to cover the
// quantity needed. Pure functions — no network.

import { normalize, matchesTerm, dietViolation } from "../planner/consolidate.js";

const LB_IN_G = 453.592;
const MAX_PACKAGES = 6;
const TIER_WINDOW = 0.2; // only compare prices among near-best name matches
// Words that describe the product but don't change what it is.
const FILLER = new Set(["fresh", "value", "pack", "family", "size", "large", "small", "medium", "the", "and", "of", "t&t", "tnt", "-"]);

const words = (s) => normalize(s).split(" ").filter(Boolean);
const stripSize = (name) => name.replace(/\([^)]*\)/g, " ").replace(/\b\d+(?:\.\d+)?\s*(?:pcs?|pk|g|kg|ml|l|lbs?)\b/gi, " ");

// Words that make a product a *different food* from the plain ingredient
// ("quail eggs" are not "eggs", "dried shrimp" is not "shrimp"). A product
// containing one only matches if the item itself asks for it.
const DIFFERENT_FOOD = new Set([
  "quail", "duck", "goose", "preserved", "salted", "century", "tea", "marinated", "pickled", "dried",
  "frozen", "instant", "sauce", "paste", "powder", "chip", "snack", "cracker", "noodle", "bun",
  "dumpling", "pancake", "soup", "cake", "candy", "seasoning", "jerky", "ball", "pie", "roll",
  "cooked", "fried", "roasted", "smoked", "stuffed", "spread", "drink", "juice", "bar", "cookie",
]);

/** Name relevance of a product to an item/query, 0..~1.6, plus whether every query word is present. */
export function relevance(query, productName) {
  const q = words(query);
  // "Pop Pepper with Garlic": what follows "with"/"in" is a flavour, not the product.
  // "Ground Pork - Lean": what follows " - " is a variant label.
  const core = stripSize(productName).split(/\b(?:with|in)\b/i)[0].split(/\s+-\s+/)[0];
  const p = words(core);
  const pMeaningful = p.filter((w) => !FILLER.has(w));
  if (!q.length || !p.length) return { score: 0, complete: false };
  const pSet = new Set(p);
  const hits = q.filter((w) => pSet.has(w)).length;
  const coverage = hits / q.length;
  const precision = hits / Math.max(pMeaningful.length, 1);
  const headMatch = p.at(-1) === q.at(-1);
  const flavoured = /\bflavou?r(ed)?\b/i.test(productName);
  const qSet = new Set(q);
  const differentFood = words(productName).some((w) => DIFFERENT_FOOD.has(w) && !qSet.has(w));
  const score = coverage + (headMatch ? 0.3 : 0) + 0.3 * Math.min(precision, 1) - (flavoured ? 0.5 : 0) - (differentFood ? 0.6 : 0);
  return { score, complete: coverage === 1 && !flavoured && !differentFood, coverage, headMatch: headMatch && !differentFood };
}

const dimension = (unit) => (unit === "count" ? "count" : "mass"); // g and ml treated alike (sauces, liquids)

// Rough weight of one piece/bunch, so "60 g garlic" can be compared with
// "Garlic 3pcs". Keyed by singular head noun.
const TYPICAL_GRAMS = {
  garlic: 50, onion: 150, "green onion": 100, scallion: 100, egg: 50, tomato: 120, potato: 200,
  carrot: 70, lemon: 100, lime: 60, avocado: 170, apple: 180, banana: 120, cucumber: 300,
  pepper: 150, zucchini: 200, ginger: 100, cabbage: 1000, broccoli: 400, cauliflower: 600,
  "bok choy": 250, eggplant: 300, mango: 300, orange: 150,
};

function typicalGrams(itemName) {
  const n = normalize(itemName);
  const key = Object.keys(TYPICAL_GRAMS)
    .filter((k) => n === k || n.endsWith(" " + k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? TYPICAL_GRAMS[key] : null;
}

/** Express every need in the package's dimension when a typical weight allows it. */
function needsIn(dim, needs, itemName) {
  const each = typicalGrams(itemName);
  return needs.map((n) => {
    if (dimension(n.unit) === dim || !each) return n;
    return dim === "count"
      ? { amount: n.amount / each, unit: "count", converted: true }
      : { amount: n.amount * each, unit: "g", converted: true };
  });
}

/**
 * Cost to cover `need` with this product.
 * @returns {{packages, cost, packAmount, flags: string[]}}
 */
export function costFor(product, rawNeeds, itemName = "") {
  const flags = [];
  const size = product.size;
  // Price for one package. Per-lb items are sold as a pack of ~size weight.
  const packWeightG = size && size.unit !== "count" ? size.amount : null;
  const unitPrice = product.perLb ? product.price * ((packWeightG ?? LB_IN_G) / LB_IN_G) : product.price;
  if (product.perLb && !packWeightG) flags.push("weight-estimated");
  if (product.perLb && size?.approx) flags.push("price-by-weight");

  const needs = size ? needsIn(dimension(size.unit), rawNeeds, itemName) : rawNeeds;
  // Sum every need expressible in the package's unit (e.g. 3 onions + 150 g onion).
  const compatible = size ? needs.filter((n) => dimension(n.unit) === dimension(size.unit)) : [];
  const need = compatible.length ? { amount: compatible.reduce((s, n) => s + n.amount, 0) } : null;
  if (compatible.some((n) => n.converted)) flags.push("estimated-quantity");
  let packages = 1;
  if (!size || !need) {
    flags.push("check-quantity");
  } else {
    packages = Math.max(1, Math.ceil(need.amount / size.amount - 1e-9));
    if (packages > MAX_PACKAGES) {
      packages = MAX_PACKAGES;
      flags.push("check-quantity");
    }
    if (needs.some((n) => dimension(n.unit) !== dimension(size.unit))) flags.push("check-quantity");
  }
  return { packages, cost: round2(unitPrice * packages), packPrice: round2(unitPrice), flags: [...new Set(flags)] };
}

const round2 = (x) => Math.round(x * 100) / 100;

function unitPriceLabel(product, packPrice) {
  const s = product.size;
  if (!s) return null;
  if (s.unit === "count") return { value: round2(packPrice / s.amount), per: "each" };
  return { value: round2((packPrice / s.amount) * 100), per: s.unit === "ml" ? "100ml" : "100g" };
}

function unsafe(productName, profile) {
  const allergy = profile.allergies.find((a) => matchesTerm(productName, a));
  if (allergy) return `contains "${allergy}"`;
  const avoid = profile.avoid.find((a) => matchesTerm(productName, a));
  if (avoid) return `on your avoid list ("${avoid}")`;
  const diet = dietViolation(stripSize(productName), profile.diet);
  if (diet) return `not ${profile.diet}`;
  return null;
}

/**
 * @param {object} item     toBuy entry: {name, searchTerm, quantities}
 * @param {object[]} products  parsed search results
 * @param {object} profile
 * @param {string} query    the search that produced these products
 */
export function pickProduct(item, products, profile, query = item.searchTerm ?? item.name, { fallback = false } = {}) {
  const excluded = [];
  const scored = [];
  for (const p of products) {
    const why = unsafe(p.name, profile);
    if (why) {
      excluded.push({ name: p.name, reason: why });
      continue;
    }
    const vsQuery = relevance(query, p.name);
    const vsItem = relevance(item.name, p.name);
    const r = vsQuery.score >= vsItem.score ? vsQuery : vsItem;
    if (!r.complete && !(r.coverage >= 0.5 && r.headMatch)) continue;
    const c = costFor(p, item.quantities, item.name);
    scored.push({
      product: p,
      score: r.score,
      // The planner's own search term counts as exact; a simplified fallback query does not.
      exact: vsItem.complete || (!fallback && vsQuery.complete),
      ...c,
    });
  }
  if (!scored.length) return { status: "not_found", query, chosen: null, alternatives: [], excluded };

  const best = Math.max(...scored.map((s) => s.score));
  const tier = scored.filter((s) => s.score >= best - TIER_WINDOW);
  // Products whose size can't be compared with the need (e.g. duck eggs by
  // weight when 18 eggs are needed) go last; then the cheapest that covers it.
  const unsure = (s) => (s.flags.includes("check-quantity") ? 1 : 0);
  tier.sort((a, b) => unsure(a) - unsure(b) || a.cost - b.cost || b.score - a.score);
  const others = scored.filter((s) => s !== tier[0]).sort((a, b) => b.score - a.score || a.cost - b.cost);

  const view = (s) => ({
    name: s.product.name,
    url: s.product.url,
    image: s.product.image,
    price: s.product.price,
    wasPrice: s.product.wasPrice,
    perLb: s.product.perLb,
    discountPct: s.product.discountPct,
    note: s.product.note,
    size: s.product.size,
    packages: s.packages,
    packPrice: s.packPrice,
    cost: s.cost,
    unitPrice: unitPriceLabel(s.product, s.packPrice),
    flags: s.flags,
  });

  const chosen = view(tier[0]);
  const uncertain = !tier[0].exact || chosen.flags.includes("check-quantity") || !chosen.url;
  if (!chosen.url) chosen.flags.push("no-link");
  return {
    status: uncertain ? "uncertain" : "matched",
    query,
    chosen,
    alternatives: [...tier.slice(1), ...others.filter((o) => !tier.includes(o))].slice(0, 3).map(view),
    excluded,
  };
}
