import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSelections, applyEdits, summarize, carryOver, optionsOf } from "./cart.js";

const product = (name, packPrice, packages = 1, url = `https://www.tntsupermarket.com/eng/${name.replace(/\W+/g, "-")}.html`) =>
  ({ name, packPrice, packages, cost: packPrice * packages, url, flags: [] });

const research = () => ({
  items: [
    { name: "eggs", status: "matched", query: "eggs", chosen: product("Large Eggs 18", 6.79), alternatives: [product("Large Eggs 12", 5.29, 2), product("Organic Eggs 12", 10.99, 2)] },
    { name: "firm tofu", status: "matched", query: "firm tofu", chosen: product("Firm Tofu", 1.97, 3), alternatives: [] },
    { name: "green onions", status: "uncertain", query: "green onion", chosen: product("Green Onion", 0.75, 2), alternatives: [product("Chive", 3.99)] },
    { name: "saffron", status: "not_found", query: "saffron", chosen: null, alternatives: [] },
  ],
});

test("defaults: chosen product at its suggested pack count; not-found adds nothing", () => {
  const r = research();
  const s = summarize(r, defaultSelections(r), 100);
  assert.equal(s.total, 6.79 + 5.91 + 1.5);
  assert.equal(s.itemCount, 3);
  assert.equal(s.lines[3].missing, true);
  assert.deepEqual(s.warnings.map((w) => w.type), ["uncertain", "not-found"]);
});

test("swap uses the option's pack price and suggested packs; explicit packages win", () => {
  const r = research();
  let { selections } = applyEdits(r, defaultSelections(r), [{ index: 0, name: "eggs", option: 1 }]);
  assert.deepEqual(selections[0], { option: 1, packages: 2, removed: false });
  assert.equal(summarize(r, selections, 100).lines[0].cost, 10.58);
  ({ selections } = applyEdits(r, selections, [{ index: 0, name: "eggs", option: 2, packages: 1 }]));
  assert.equal(summarize(r, selections, 100).lines[0].cost, 10.99);
});

test("remove and restore", () => {
  const r = research();
  let { selections } = applyEdits(r, defaultSelections(r), [{ index: 1, name: "firm tofu", removed: true }]);
  const s = summarize(r, selections, 100);
  assert.equal(s.lines[1].removed, true);
  assert.equal(s.lines[1].cost, 0);
  assert.equal(s.itemCount, 2);
  ({ selections } = applyEdits(r, selections, [{ index: 1, name: "firm tofu", removed: false }]));
  assert.equal(summarize(r, selections, 100).lines[1].cost, 5.91);
});

test("validation errors", () => {
  const r = research();
  const sel = defaultSelections(r);
  const fields = (edits) => applyEdits(r, sel, edits).errors?.map((e) => e.field);
  assert.deepEqual(fields([]), ["edits"]);
  assert.deepEqual(fields([{ index: 9, name: "x" }]), ["index"]);
  assert.deepEqual(fields([{ index: 0, name: "milk" }]), ["name"]);
  assert.deepEqual(fields([{ index: 0, name: "eggs", option: 3 }]), ["option"]);
  assert.deepEqual(fields([{ index: 0, name: "eggs", packages: 0 }]), ["packages"]);
  assert.deepEqual(fields([{ index: 0, name: "eggs", packages: 2.5 }]), ["packages"]);
  assert.deepEqual(fields([{ index: 0, name: "eggs", removed: "yes" }]), ["removed"]);
  assert.deepEqual(fields([{ index: 0, name: "eggs", price: 0.01 }]), ["price"]);
  assert.deepEqual(fields([{ index: 3, name: "saffron", removed: false }]), ["removed"]);
  // Nothing is applied when any edit is invalid.
  assert.equal(applyEdits(r, sel, [{ index: 0, name: "eggs", removed: true }, { index: 0, name: "eggs", option: 9 }]).selections, undefined);
});

test("over budget names the biggest lines; missing links are flagged", () => {
  const r = research();
  r.items[1].chosen.url = null;
  const s = summarize(r, defaultSelections(r), 10);
  const budget = s.warnings.find((w) => w.type === "budget");
  assert.match(budget.message, /over your \$10 budget/);
  assert.match(budget.message, /eggs \(\$6\.79\), firm tofu \(\$5\.91\), green onions \(\$1\.50\)/);
  assert.ok(s.warnings.some((w) => w.type === "no-link" && w.message.includes("firm tofu")));
  assert.equal(s.readyForAgent, 2);
});

test("carryOver keeps removals and the same product by URL", () => {
  const old = research();
  const { selections } = applyEdits(old, defaultSelections(old), [
    { index: 0, name: "eggs", option: 2, packages: 3 },
    { index: 1, name: "firm tofu", removed: true },
  ]);
  const fresh = research();
  // New pricing returns the organic eggs first this time.
  fresh.items[0].alternatives.unshift(fresh.items[0].chosen);
  fresh.items[0].chosen = optionsOf(old.items[0])[2];
  fresh.items[0].alternatives = fresh.items[0].alternatives.filter((a) => a.url !== fresh.items[0].chosen.url);
  const carried = carryOver(old, selections, fresh);
  assert.deepEqual(carried[0], { option: 0, packages: 3, removed: false });
  assert.equal(carried[1].removed, true);
  assert.deepEqual(carried[2], { option: 0, packages: 2, removed: false });
  assert.equal(carried[3].removed, false); // not found: nothing to remove
});
