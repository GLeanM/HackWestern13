import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSearch, parseSize, searchUrl } from "./tntParser.js";
import fixtures from "./fixtures/tnt-search.json" with { type: "json" };

const parse = (q) => parseSearch(fixtures[q]).products;

test("single-line results with sale prices (tofu)", () => {
  const p = parse("firm tofu");
  assert.equal(p.length, 8);
  assert.deepEqual(
    { name: p[0].name, price: p[0].price, wasPrice: p[0].wasPrice, discountPct: p[0].discountPct, size: p[0].size.amount },
    { name: "Superior Natural Firm Tofu (454g)", price: 1.97, wasPrice: 2.59, discountPct: 24, size: 454 },
  );
  assert.equal(p[1].wasPrice, null);
  assert.match(p[0].url, /\/eng\/51280001-superior-firm-tofu\.html$/);
  assert.match(p[0].image, /\/media\/catalog\/product\//);
});

test("multi-line results with per-lb prices (bok choy)", () => {
  const [napa, bokChoy] = parse("baby bok choy");
  assert.equal(napa.perLb, true);
  assert.equal(bokChoy.name, "Baby Bok Choy Sum (~1.5lb)");
  assert.equal(bokChoy.price, 1.68);
  assert.equal(bokChoy.wasPrice, 2.4);
  assert.equal(bokChoy.size.approx, true);
});

test("eggs: 11 products all linked, discount on the 18-pack", () => {
  const p = parse("large eggs");
  assert.equal(p.length, 11);
  assert.ok(p.every((x) => x.url && x.size?.unit === "count"));
  const omega18 = p.find((x) => x.name.includes("(18pcs)"));
  assert.deepEqual([omega18.price, omega18.wasPrice, omega18.discountPct], [6.79, 8.69, 22]);
});

test("bunch, kg, and no-results pages", () => {
  assert.deepEqual(parse("green onions").at(-1).size, { amount: 1, unit: "count", approx: false, label: "1bunch" });
  assert.equal(parse("napa cabbage kimchi")[1].size.amount, 1200);
  assert.equal(parseSearch(fixtures["boneless chicken thighs"]).empty, true);
  assert.equal(parseSearch(fixtures["xyzzyqwerty"]).products.length, 0);
});

test("'Available:' notes are split from the name", () => {
  const r = parseSearch({ text: 'Search results"eggs"T&T Kitchen Tea-Flavoured Eggs (Cold, 5 pcs)Available: After 12PM$4.99Oops!' });
  assert.equal(r.products[0].name, "T&T Kitchen Tea-Flavoured Eggs (Cold, 5 pcs)");
  assert.equal(r.products[0].note, "Available: After 12PM");
  assert.equal(r.products[0].size.amount, 5);
});

test("when counts differ, links are paired by slug, never by position", () => {
  const full = parseSearch(fixtures["firm tofu"]).products;
  // Drop two product links (San Sui, Sunrise) so positions no longer line up.
  const links = fixtures["firm tofu"].links.filter((l) => !/san-sui|sunrise/.test(l));
  const r = parseSearch({ ...fixtures["firm tofu"], links });
  assert.equal(r.linked, false);
  r.products.forEach((p, i) => {
    if (/San Sui|Sunrise/.test(p.name)) assert.equal(p.url, null, p.name);
    // Every link that is given must be the right one; ambiguous ones stay null.
    else if (p.url !== null) assert.equal(p.url, full[i].url, p.name);
  });
  // The four Superior products have distinctive slugs and must all be linked.
  assert.equal(r.products.filter((p) => p.name.startsWith("Superior") && p.url).length, 4);
});

test("multi-buy deals attach to the product before them", () => {
  const r = parseSearch({
    text: 'Search results"green onion"Green Onion (1bunch)$0.75Tenten Pork & Green Onion Dumplings (800g)$7.992 for $7.97ViewTen Ten Dim Sum Green Onion Flower Bun (440g)$4.99Oops!',
    links: [
      "https://www.tntsupermarket.com/eng/05014501-green-onion.html",
      "https://www.tntsupermarket.com/eng/78532201-tenten-pork-green-onion-dumpling.html",
      "https://www.tntsupermarket.com/eng/65075701-ten-ten-green-onion-flower-bun.html",
    ],
  });
  assert.deepEqual(r.products.map((p) => p.name), [
    "Green Onion (1bunch)",
    "Tenten Pork & Green Onion Dumplings (800g)",
    "Ten Ten Dim Sum Green Onion Flower Bun (440g)",
  ]);
  assert.deepEqual(r.products[1].deal, { quantity: 2, price: 7.97 });
  assert.equal(r.linked, true);
});

test("parseSize units", () => {
  const s = (x) => parseSize(x) && [parseSize(x).amount, parseSize(x).unit];
  assert.deepEqual(s("Quail Eggs (20x25g)"), [500, "g"]);
  assert.deepEqual(s("Pork (~1.5lb)"), [680, "g"]);
  assert.deepEqual(s("Eggs (12s)"), [12, "count"]);
  assert.deepEqual(s("Garlic 3pcs"), [3, "count"]);
  assert.deepEqual(s("Milk (2L)"), [2000, "ml"]);
  assert.equal(parseSize("Plain Cookies"), null);
});

test("search URL encodes the query", () => {
  assert.equal(searchUrl("bok choy & tofu"), "https://www.tntsupermarket.com/eng/search.html?query=bok%20choy%20%26%20tofu");
});
