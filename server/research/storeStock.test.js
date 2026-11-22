import { test } from "node:test";
import assert from "node:assert/strict";
import { fsaOf, observationsFrom, applyStoreStock } from "./storeStock.js";
import { openDb } from "../db.js";

const p = (name, cost, url = `https://www.tntsupermarket.com/eng/${name.replace(/\W+/g, "-")}.html`) =>
  ({ name, cost, packPrice: cost, packages: 1, url, flags: [] });
const research = () => ({
  budget: 20, total: 13.29, warnings: [],
  items: [
    { name: "eggs", status: "matched", chosen: p("Large Eggs 12", 5.29), alternatives: [p("Large Eggs 30", 10.79), p("Omega Eggs 18", 6.79)] },
    { name: "tofu", status: "matched", chosen: p("Firm Tofu", 2), alternatives: [] },
    { name: "saffron", status: "not_found", chosen: null, alternatives: [] },
  ],
});
const url = (name) => p(name, 0).url;

test("fsaOf takes the postal area", () => {
  assert.equal(fsaOf("n6g 1a1"), "N6G");
  assert.equal(fsaOf("N6G"), "N6G");
  assert.equal(fsaOf(""), null);
  assert.equal(fsaOf("12345"), null);
});

test("nothing known → research unchanged", () => {
  const r = applyStoreStock(research(), new Map(), "N6G");
  assert.equal(r.total, 13.29);
  assert.equal(r.items[0].chosen.name, "Large Eggs 12");
  assert.equal(r.store.swapped, 0);
});

test("unstocked pick swaps to an option seen in stock, then to an unknown one", () => {
  const known = new Map([[url("Large Eggs 12"), "unavailable"], [url("Omega Eggs 18"), "available"]]);
  const r = applyStoreStock(research(), known, "N6G");
  assert.equal(r.items[0].chosen.name, "Omega Eggs 18"); // seen in stock beats cheaper unknown
  assert.ok(r.items[0].chosen.flags.includes("store-swapped"));
  assert.ok(r.items[0].alternatives.some((a) => a.name === "Large Eggs 12" && a.storeStock === "unavailable"));
  assert.equal(r.total, 8.79);
  assert.match(r.warnings.at(-1).message, /Switched to products your N6G store had last time: eggs/);

  const r2 = applyStoreStock(research(), new Map([[url("Large Eggs 12"), "unavailable"]]), "N6G");
  assert.equal(r2.items[0].chosen.name, "Large Eggs 30");
});

test("no stocked option left → flagged, not hidden", () => {
  const r = applyStoreStock(research(), new Map([[url("Firm Tofu"), "unavailable"]]), "N6G");
  assert.equal(r.items[1].chosen.name, "Firm Tofu");
  assert.ok(r.items[1].chosen.flags.includes("not-at-your-store"));
  assert.equal(r.items[1].status, "uncertain");
  assert.match(r.warnings.at(-1).message, /Not stocked at your N6G store last time: tofu/);
});

test("observations and the store: out of stock counts at once, 'not found' only twice, 'added' clears it", () => {
  const db = openDb(":memory:");
  const run = (outcome) => ({ items: [{ url: url("Large Eggs 12"), outcome }, { url: url("Firm Tofu"), outcome: "out_of_stock" }] });
  assert.deepEqual(observationsFrom(run("unavailable")).map((o) => o.seen), ["not_found", "out_of_stock"]);
  // A substitute went in, so the approved product wasn't there.
  assert.deepEqual(observationsFrom(run("substituted")).map((o) => o.seen), ["not_found", "out_of_stock"]);

  db.recordStoreStock("N6G", observationsFrom(run("unavailable")));
  let known = db.storeStock("N6G");
  assert.equal(known.get(url("Large Eggs 12")), undefined); // one miss could be the agent's mistake
  assert.equal(known.get(url("Firm Tofu")), "unavailable");

  db.recordStoreStock("N6G", observationsFrom(run("unavailable")));
  assert.equal(db.storeStock("N6G").get(url("Large Eggs 12")), "unavailable");

  db.recordStoreStock("N6G", observationsFrom({ items: [{ url: url("Large Eggs 12"), outcome: "added" }] }));
  known = db.storeStock("N6G");
  assert.equal(known.get(url("Large Eggs 12")), "available");
  assert.equal(db.storeStock("L3T").size, 0); // other stores unaffected
  db.close();
});
