import { test } from "node:test";
import assert from "node:assert/strict";
import { researchList, fallbackQueries } from "./research.js";
import { searchUrl } from "./tntParser.js";
import fixtures from "./fixtures/tnt-search.json" with { type: "json" };

const profile = { budget: 30, allergies: [], avoid: [], diet: "none" };
const fakeFetch = (fail = new Set()) => {
  const calls = [];
  const fn = async (urls) => {
    calls.push(urls);
    return new Map(urls.map((u) => {
      const q = decodeURIComponent(new URL(u).searchParams.get("query"));
      if (fail.has(q)) return [u, { ok: false, error: "timeout" }];
      return [u, fixtures[q] ?? { ok: true, text: 'Search results"x"Sorry! We couldn\'t find any products.', links: [], images: [] }];
    }));
  };
  fn.calls = calls;
  return fn;
};

const toBuy = [
  { name: "boneless chicken thighs", searchTerm: "boneless chicken thighs", category: "meat-seafood", quantities: [{ amount: 800, unit: "g" }] },
  { name: "firm tofu", searchTerm: "firm tofu", category: "tofu-plant-protein", quantities: [{ amount: 454, unit: "g" }] },
  { name: "saffron", searchTerm: "saffron", category: "pantry", quantities: [{ amount: 1, unit: "g" }] },
];

test("fallback queries drop adjectives, then use the head noun", () => {
  assert.deepEqual(fallbackQueries("boneless chicken thighs"), ["chicken thighs", "thigh"]);
  assert.deepEqual(fallbackQueries("garlic"), []);
});

test("prices a list with a fallback search, totals, and budget warning", async () => {
  const fetchPages = fakeFetch();
  const r = await researchList(toBuy, profile, { fetchPages, now: () => new Date("2026-11-21T20:00:00Z") });
  const [chicken, tofu, saffron] = r.items;
  assert.equal(chicken.query, "chicken thighs"); // found on the second round
  assert.match(chicken.chosen.name, /Chicken Thigh Boneless/);
  assert.equal(tofu.chosen.cost, 1.97);
  assert.equal(saffron.status, "not_found");
  assert.equal(r.total, Math.round((chicken.chosen.cost + 1.97) * 100) / 100);
  assert.equal(r.overBudget, false);
  assert.ok(r.warnings.some((w) => w.type === "not-found"));
  assert.equal(r.retrievedAt, "2026-11-21T20:00:00.000Z");
  // round 1: all three; round 2: only chicken ("saffron" has no simpler query)
  assert.equal(fetchPages.calls[0].length, 3);
  assert.deepEqual(fetchPages.calls[1], [searchUrl("chicken thighs")]);
});

test("over budget and failed fetches are reported", async () => {
  const r = await researchList(toBuy.slice(0, 2), { ...profile, budget: 5 }, { fetchPages: fakeFetch(new Set(["firm tofu", "tofu"])) });
  assert.equal(r.overBudget, true);
  assert.equal(r.items[1].status, "not_found");
  assert.ok(r.warnings.some((w) => w.type === "budget"));
  assert.ok(r.warnings.some((w) => w.type === "fetch"));
});
