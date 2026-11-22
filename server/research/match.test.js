import { test } from "node:test";
import assert from "node:assert/strict";
import { pickProduct, relevance, costFor } from "./match.js";
import { parseSearch } from "./tntParser.js";
import fixtures from "./fixtures/tnt-search.json" with { type: "json" };

const profile = (o = {}) => ({ allergies: [], avoid: [], diet: "none", ...o });
const pick = (name, q, quantities, prof = profile()) =>
  pickProduct({ name, searchTerm: q, quantities }, parseSearch(fixtures[q]).products, prof, q);

test("relevance ranks the real green onion above a fish ball and chives", () => {
  const r = pick("green onions", "green onions", [{ amount: 145, unit: "g" }]);
  assert.equal(r.chosen.name, "Green Onion (1bunch)");
  // 145 g at ~100 g per bunch → 2 bunches, marked as an estimate.
  assert.equal(r.chosen.packages, 2);
  assert.ok(r.chosen.flags.includes("estimated-quantity"));
  assert.ok(!r.alternatives.some((a) => a.name.includes("Dace Ball")));
});

test("variant suffixes and flavours don't win: ground pork and garlic", () => {
  assert.ok(relevance("garlic", "Garlic 3pcs").score > relevance("garlic", "Tan Tan Xiang Pop Pepper with Garlic (280g)").score);
  assert.equal(relevance("garlic", "Ilocos Garlic flavour Chichacorn (350g)").complete, false);
  const pork = pick("ground pork", "ground pork", [{ amount: 850, unit: "g" }]);
  assert.equal(pork.chosen.name, "Ground Pork - Regular (~2lb)");
  assert.equal(pork.chosen.cost, 5.98); // $2.99/lb × ~2lb
});

test("cheapest way to cover the quantity", () => {
  const eggs = pick("eggs", "large eggs", [{ amount: 18, unit: "count" }]);
  assert.equal(eggs.chosen.name, "Burnbrae Farms Omega 3 Large Eggs (18pcs)"); // $6.79 beats 2 × 12
  const tofu = pick("firm tofu", "firm tofu", [{ amount: 1000, unit: "g" }]);
  assert.equal(tofu.chosen.packages, 3);
  assert.equal(tofu.chosen.cost, 5.91);
  assert.equal(tofu.status, "matched");
});

test("per-lb pricing uses the pack weight", () => {
  const p = { name: "Baby Bok Choy Sum (~1.5lb)", price: 1.68, perLb: true, size: { amount: 680, unit: "g", approx: true } };
  const c = costFor(p, [{ amount: 750, unit: "g" }]);
  assert.equal(c.packages, 2);
  assert.equal(c.cost, 5.04);
  assert.ok(c.flags.includes("price-by-weight"));
});

test("allergen and diet products are excluded", () => {
  const garlic = pick("garlic", "garlic", [{ amount: 60, unit: "g" }], profile({ allergies: ["peanuts"] }));
  assert.ok(garlic.excluded.some((e) => e.name.includes("Peanuts")));
  assert.ok(![garlic.chosen, ...garlic.alternatives].some((p) => /peanut/i.test(p.name)));
  const pork = pick("ground pork", "ground pork", [{ amount: 500, unit: "g" }], profile({ diet: "vegetarian" }));
  assert.equal(pork.status, "not_found");
});

test("nothing relevant → not_found", () => {
  const r = pickProduct({ name: "saffron", searchTerm: "saffron", quantities: [{ amount: 1, unit: "g" }] },
    parseSearch(fixtures["green onions"]).products, profile(), "saffron");
  assert.equal(r.status, "not_found");
  assert.equal(r.chosen, null);
});

test("a different food is not a match: quail/duck/preserved eggs vs eggs", () => {
  const products = [
    { name: "Springcreek Quail Farms Quail Eggs (18pcs)", price: 4.59, size: { amount: 18, unit: "count" }, url: "u1" },
    { name: "China Maid Preserved Duck Eggs (375g)", price: 3.99, size: { amount: 375, unit: "g" }, url: "u2" },
    { name: "Burnbrae Farms Large Eggs (12pcs)", price: 5.29, size: { amount: 12, unit: "count" }, url: "u3" },
  ];
  const r = pickProduct({ name: "eggs", searchTerm: "eggs", quantities: [{ amount: 18, unit: "count" }] }, products, profile(), "eggs");
  assert.equal(r.chosen.name, "Burnbrae Farms Large Eggs (12pcs)");
  assert.equal(r.chosen.packages, 2);
  // ...but asking for quail eggs finds them.
  const q = pickProduct({ name: "quail eggs", searchTerm: "quail eggs", quantities: [{ amount: 18, unit: "count" }] }, products, profile(), "quail eggs");
  assert.match(q.chosen.name, /Quail/);
});
