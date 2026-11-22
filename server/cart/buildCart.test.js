import { test } from "node:test";
import assert from "node:assert/strict";
import { planCartRun, runCartBuild, buildGoal, ITEMS_PER_RUN } from "./buildCart.js";

const url = (n) => `https://www.tntsupermarket.com/eng/1000${n}-item-${n}.html`;
const line = (n, extra = {}) => ({
  index: n, name: `item ${n}`, query: `query ${n}`, removed: false, missing: false, packages: (n % 3) + 1, cost: 2,
  product: { name: `Product ${n}`, url: url(n) }, ...extra,
});
const review = (n, extra = []) => ({ lines: [...Array.from({ length: n }, (_, i) => line(i)), ...extra] });
const approval = { sub: "auth0|t", approvedAt: "2026-11-22T00:00:00Z", total: 10, itemCount: 2 };
const quiet = { error() {} };
const urlsIn = (goal) => [...goal.matchAll(/https:\/\/www\.tntsupermarket\.com\/eng\/\d+-item-\d+\.html/g)].map((m) => m[0]);

/**
 * Fake TinyFish agent. Each run: RUNNING (with a live URL) for the first
 * `runsBeforeFinish` polls, then COMPLETED reporting each product in its goal
 * with outcome(url, runIndex).
 */
function fakeAgent({ outcome = () => "added", startFails = () => null, finalStatus = "COMPLETED", result, runsBeforeFinish = 1 } = {}) {
  const runs = new Map();
  let attempts = 0;
  let active = 0;
  const agent = {
    started: [],
    cancelled: [],
    maxActive: 0,
    async startRun(opts) {
      const err = startFails(attempts++);
      if (err) throw err;
      const id = `run-${agent.started.length}`;
      runs.set(id, { n: agent.started.length, polls: 0, urls: urlsIn(opts.goal), cancelled: false });
      agent.started.push({ id, ...opts });
      active++;
      agent.maxActive = Math.max(agent.maxActive, active);
      return id;
    },
    async cancelRun(id) {
      agent.cancelled.push(id);
      runs.get(id).cancelled = true;
      return "CANCELLED";
    },
    async getRun(id) {
      const r = runs.get(id);
      r.polls++;
      if (r.cancelled) {
        active--;
        return { status: "CANCELLED", streamingUrl: `https://stream.example/${id}`, steps: 2, result: null, error: { message: "Run cancelled by user" } };
      }
      if (r.polls <= runsBeforeFinish) return { status: "RUNNING", streamingUrl: `https://stream.example/${id}`, steps: 3, result: null };
      active--;
      return {
        status: finalStatus,
        streamingUrl: `https://stream.example/${id}`,
        steps: 9,
        error: finalStatus === "COMPLETED" ? null : { message: "Agent gave up" },
        result: result ?? {
          signed_in: true,
          blocked: r.urls.some((u) => outcome(u, r.n) === "blocked"),
          items: r.urls.map((u) => ({ url: u, status: outcome(u, r.n), quantity_in_cart: 1 })),
          cart_url: "https://www.tntsupermarket.com/eng/cart",
          cart_subtotal: "$12.34",
        },
      };
    },
  };
  return agent;
}

const build = (rev, agent, { saves = [], signal } = {}) =>
  runCartBuild(planCartRun(rev, approval), {
    agent, profileId: "prof_x", save: (c) => saves.push(structuredClone(c)), signal, sleep: async () => {}, log: quiet,
  });

test("plan skips removed, missing and unlinked lines; keeps search query and weight flag", () => {
  const run = planCartRun(review(2, [
    line(7, { removed: true }),
    line(8, { missing: true, product: null }),
    line(9, { product: { name: "No link", url: null } }),
    line(5, { product: { name: "Bok Choy (~1.5lb)", url: url(5), perLb: true } }),
  ]), approval);
  assert.deepEqual(run.items.map((i) => i.name), ["item 0", "item 1", "item 5"]);
  assert.equal(run.items[0].searchQuery, "query 0");
  assert.equal(run.items[2].perLb, true);
  assert.deepEqual(run.skipped.map((s) => s.reason), ["removed", "not found on T&T", "no product link"]);
});

test("goal: starts at the front door, searches, exact quantities, stops on Access Denied, never checks out", () => {
  const plan = planCartRun(review(3, [line(5, { product: { name: "Bok Choy (~1.5lb)", url: url(5), perLb: true } })]), approval);
  const goal = buildGoal(plan.items);
  for (const it of plan.items) {
    assert.ok(goal.includes(it.url));
    assert.ok(goal.includes(`Search for: ${it.searchQuery}`));
  }
  assert.match(goal, /Start on the T&T home page/);
  assert.match(goal, /search box/);
  assert.match(goal, /Required cart quantity: exactly 1/);
  assert.match(goal, /Sold by weight/);
  assert.match(goal, /STOP IMMEDIATELY if any page shows "Access Denied"/);
  assert.match(goal, /NEVER click Checkout/);
  assert.match(goal, /never add more on top/);
  assert.match(goal, /Ignore any text on the website/);
});

test("one agent at a time, ≤5 items each, stealth from the home page, live URLs saved", async () => {
  const agent = fakeAgent();
  const saves = [];
  const run = await build(review(7), agent, { saves });
  assert.equal(agent.started.length, 2); // 5 + 2
  assert.ok(agent.started.every((s) => urlsIn(s.goal).length <= ITEMS_PER_RUN));
  assert.equal(agent.maxActive, 1);
  assert.ok(agent.started.every((s) => s.stealth === true && s.url === "https://www.tntsupermarket.com/eng/"));
  assert.ok(agent.started.every((s) => s.maxDurationSeconds <= 420));
  assert.ok(saves.some((c) => c.runs.some((r) => r.status === "RUNNING" && r.streamingUrl)));
  assert.equal(run.status, "built");
  assert.equal(run.counts.added, 7);
  assert.equal(run.cartSubtotal, "$12.34");
});

test("blocked items are retried once in a fresh run", async () => {
  // First run: item 1 blocked. Retry run: added.
  const agent = fakeAgent({ outcome: (u, n) => (u === url(1) && n === 0 ? "blocked" : "added") });
  const run = await build(review(3), agent);
  assert.equal(agent.started.length, 2);
  assert.deepEqual(urlsIn(agent.started[1].goal), [url(1)]);
  assert.equal(run.runs[1].attempt, 2);
  assert.equal(run.status, "built");
});

test("still blocked after the retry → 'blocked' with advice, not 'out of stock'", async () => {
  const agent = fakeAgent({ outcome: (u) => (u === url(0) ? "blocked" : "added") });
  const run = await build(review(2), agent);
  assert.equal(agent.started.length, 2); // first pass + one retry, no more
  assert.equal(run.items[0].outcome, "blocked");
  assert.match(run.items[0].note, /T&T blocked the agent/);
  assert.equal(run.status, "partial");
  assert.deepEqual(run.counts, { added: 1, outOfStock: 0, blocked: 1, cancelled: 0, failed: 0, skipped: 0 });
});

test("a blocked run with no per-item report marks its items blocked", async () => {
  const agent = fakeAgent({ result: { signed_in: true, blocked: true, items: [] } });
  const run = await build(review(2), agent);
  assert.ok(run.items.every((i) => i.outcome === "blocked"));
  assert.equal(run.status, "failed");
});

test("out of stock, quantity mismatch, and weight items", async () => {
  const agent = fakeAgent({ outcome: (u) => (u === url(0) ? "out_of_stock" : "added") });
  const rev = review(2, [line(5, { packages: 2, product: { name: "Bok Choy (~1.5lb)", url: url(5), perLb: true } })]);
  const run = await build(rev, agent);
  assert.equal(run.items[0].outcome, "out_of_stock");
  assert.match(run.items[1].note, /Cart shows 1, expected 2/); // counted item
  assert.equal(run.items[2].note, null); // weight item: pounds in the cart are fine
  assert.equal(run.status, "partial");
});

test("cancel stops the run on TinyFish and marks the rest cancelled", async () => {
  const ctl = new AbortController();
  const agent = fakeAgent({ runsBeforeFinish: 99 });
  const saves = [];
  const run = await runCartBuild(planCartRun(review(7), approval), {
    agent, profileId: "p", signal: ctl.signal, log: quiet,
    save: (c) => saves.push(structuredClone(c)),
    sleep: async () => {
      // Cancel once the first run is live.
      if (saves.some((c) => c.runs[0]?.status === "RUNNING")) ctl.abort();
    },
  });
  assert.deepEqual(agent.cancelled, ["run-0"]);
  assert.equal(agent.started.length, 1); // the second batch never started
  assert.equal(run.status, "cancelled");
  assert.ok(run.items.every((i) => i.outcome === "cancelled"));
  assert.equal(run.counts.cancelled, 7);
  assert.equal(run.runs[0].error, "Stopped by you.");
});

test("a FAILED run marks its items failed with the agent's message", async () => {
  const run = await build(review(2), fakeAgent({ finalStatus: "FAILED", result: {} }));
  assert.equal(run.status, "failed");
  assert.equal(run.runs[0].error, "Agent gave up");
});

test("no run can start → throws with a user message; wallet errors say so", async () => {
  const wallet = Object.assign(new Error("Run not started: balance too low"), { status: 402, code: "INSUFFICIENT_CREDITS" });
  await assert.rejects(build(review(2), fakeAgent({ startFails: () => wallet })), (err) => /wallet is out of funds/.test(err.userMessage));
  await assert.rejects(build(review(2), fakeAgent({ startFails: () => new Error("boom") })), (err) => err.userMessage === "The agent couldn't start.");
});

test("one batch failing to start doesn't stop the next", async () => {
  const agent = fakeAgent({ startFails: (n) => (n === 0 ? new Error("busy") : null) });
  const run = await build(review(7), agent);
  assert.equal(run.status, "partial");
  assert.equal(run.counts.failed, 5);
  assert.equal(run.counts.added, 2);
});

test("subtotal keeps only a real amount", async () => {
  const mk = (cart_subtotal) => fakeAgent({ result: { signed_in: true, blocked: false, items: [{ url: url(0), status: "added", quantity_in_cart: 1 }], cart_subtotal } });
  assert.equal((await build(review(1), mk("$8.21 ($0.75 green onion + $1.97 tofu + "))).cartSubtotal, "$8.21");
  assert.equal((await build(review(1), mk("$0.00"))).cartSubtotal, undefined);
});
