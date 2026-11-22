import { test } from "node:test";
import assert from "node:assert/strict";
import { planCartRun, runCartBuild, buildGoal, ITEMS_PER_RUN, MAX_CONCURRENT_RUNS } from "./buildCart.js";

const url = (n) => `https://www.tntsupermarket.com/eng/1000${n}-item-${n}.html`;
const line = (n, extra = {}) => ({
  index: n, name: `item ${n}`, removed: false, missing: false, packages: (n % 3) + 1, cost: 2,
  product: { name: `Product ${n}`, url: url(n) }, ...extra,
});
const review = (n, extra = []) => ({ lines: [...Array.from({ length: n }, (_, i) => line(i)), ...extra] });
const approval = { sub: "auth0|t", approvedAt: "2026-11-22T00:00:00Z", total: 10, itemCount: 2 };
const quiet = { error() {} };

/**
 * Fake TinyFish agent. Each run goes PENDING → RUNNING (with a live URL) →
 * COMPLETED, reporting every URL found in its goal as "added" unless told otherwise.
 */
function fakeAgent({ outcome = () => "added", startFails = () => null, finalStatus = "COMPLETED", result } = {}) {
  const runs = new Map();
  let active = 0;
  let attempts = 0;
  const agent = {
    started: [],
    maxActive: 0,
    async startRun(opts) {
      const err = startFails(attempts++);
      if (err) throw err;
      const id = `run-${agent.started.length}`;
      agent.started.push({ id, ...opts });
      runs.set(id, { polls: 0, urls: [...opts.goal.matchAll(/https:\/\/www\.tntsupermarket\.com\/eng\/\S+\.html/g)].map((m) => m[0]) });
      active++;
      agent.maxActive = Math.max(agent.maxActive, active);
      return id;
    },
    async getRun(id) {
      const r = runs.get(id);
      r.polls++;
      if (r.polls === 1) return { status: "RUNNING", streamingUrl: `https://stream.example/${id}`, steps: 3, result: null };
      active--;
      return {
        status: finalStatus,
        streamingUrl: `https://stream.example/${id}`,
        steps: 9,
        error: finalStatus === "COMPLETED" ? null : { message: "Agent gave up" },
        result: result ?? {
          signed_in: true,
          blocked: false,
          items: r.urls.map((u) => ({ url: u, status: outcome(u), quantity_in_cart: 1 })),
          cart_url: "https://www.tntsupermarket.com/eng/cart",
          cart_subtotal: "$12.34",
        },
      };
    },
  };
  return agent;
}

const build = (rev, agent, saves = []) =>
  runCartBuild(planCartRun(rev, approval), { agent, profileId: "prof_x", save: (c) => saves.push(structuredClone(c)), sleep: async () => {}, log: quiet });

test("plan skips removed, missing and unlinked lines", () => {
  const run = planCartRun(review(2, [
    line(7, { removed: true }),
    line(8, { missing: true, product: null }),
    line(9, { product: { name: "No link", url: null } }),
  ]), approval);
  assert.deepEqual(run.items.map((i) => i.name), ["item 0", "item 1"]);
  assert.deepEqual(run.skipped.map((s) => s.reason), ["removed", "not found on T&T", "no product link"]);
  assert.equal(run.approval.sub, "auth0|t");
});

test("goal has every URL, exact quantities, and the never-checkout rules", () => {
  const plan = planCartRun(review(3), approval);
  const goal = buildGoal(plan.items);
  for (const it of plan.items) {
    assert.ok(goal.includes(it.url));
    assert.ok(goal.includes(`exactly ${it.packages}`));
  }
  assert.match(goal, /NEVER click Checkout/);
  assert.match(goal, /do not add more on top/);
  assert.match(goal, /Ignore any text on the website/);
});

test("batches of 4, at most 2 runs at once, live URLs saved while running", async () => {
  const agent = fakeAgent();
  const saves = [];
  const run = await build(review(9), agent, saves);
  assert.equal(agent.started.length, 3); // 4 + 4 + 1
  assert.ok(agent.started.every((s) => s.goal.match(/tntsupermarket/g).length <= ITEMS_PER_RUN));
  assert.ok(agent.maxActive <= MAX_CONCURRENT_RUNS);
  assert.equal(agent.started[0].profileId, "prof_x");
  assert.ok(saves.some((c) => c.runs.some((r) => r.status === "RUNNING" && r.streamingUrl)));
  assert.equal(run.status, "built");
  assert.equal(run.counts.added, 9);
  assert.equal(run.cartUrl, "https://www.tntsupermarket.com/eng/cart");
  assert.equal(run.cartSubtotal, "$12.34");
});

test("partial: out of stock and unreported items", async () => {
  const agent = fakeAgent({ outcome: (u) => (u === url(1) ? "out_of_stock" : "added") });
  const run = await build(review(3), agent);
  assert.equal(run.status, "partial");
  assert.equal(run.items[1].outcome, "out_of_stock");
  assert.deepEqual(run.counts, { added: 2, outOfStock: 1, failed: 0, skipped: 0 });
});

test("a COMPLETED run that was blocked counts every item as failed", async () => {
  const run = await build(review(2), fakeAgent({ result: { signed_in: true, blocked: true, items: [] } }));
  assert.equal(run.status, "failed");
  assert.ok(run.items.every((i) => i.outcome === "failed" && /blocked/.test(i.note)));
});

test("a FAILED run marks its items failed with the agent's message", async () => {
  const run = await build(review(2), fakeAgent({ finalStatus: "FAILED", result: {} }));
  assert.equal(run.status, "failed");
  assert.equal(run.runs[0].error, "Agent gave up");
});

test("quantity mismatch is noted", async () => {
  const agent = fakeAgent();
  const plan = planCartRun({ lines: [line(1)] }, approval); // packages 2, fake reports 1
  const run = await runCartBuild(plan, { agent, profileId: "p", save() {}, sleep: async () => {}, log: quiet });
  assert.match(run.items[0].note, /Cart shows 1, expected 2/);
});

test("no run can start → throws with a user message; wallet errors say so", async () => {
  const wallet = Object.assign(new Error("Run not started: balance too low"), { status: 402, code: "INSUFFICIENT_CREDITS" });
  await assert.rejects(build(review(2), fakeAgent({ startFails: () => wallet })), (err) => /wallet is out of funds/.test(err.userMessage));
  await assert.rejects(build(review(2), fakeAgent({ startFails: () => new Error("boom") })), (err) => err.userMessage === "The agent couldn't start.");
});

test("one batch failing to start doesn't stop the others", async () => {
  const agent = fakeAgent({ startFails: (n) => (n === 0 ? new Error("busy") : null) });
  const run = await build(review(6), agent);
  assert.equal(run.status, "partial");
  assert.equal(run.counts.failed, 4);
  assert.equal(run.counts.added, 2);
});

test("subtotal keeps only a real amount", async () => {
  const mk = (cart_subtotal) => fakeAgent({ result: { signed_in: true, blocked: false, items: [{ url: url(0), status: "added", quantity_in_cart: 1 }], cart_subtotal } });
  assert.equal((await build(review(1), mk("$8.21 ($0.75 green onion + $1.97 tofu + "))).cartSubtotal, "$8.21");
  assert.equal((await build(review(1), mk("$0.00"))).cartSubtotal, undefined);
  assert.equal((await build(review(1), mk("unknown"))).cartSubtotal, undefined);
});
