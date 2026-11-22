import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

// Tests sign RS256 tokens with a local key and serve its public half from a
// local JWKS endpoint — the same way production fetches Auth0's keys — so the
// real express-oauth2-jwt-bearer checks (signature, issuer, audience, expiry,
// scopes) all run.
const ISSUER = "https://test-tenant.example.com/";
const AUDIENCE = "https://cartpilot-api";
const KID = "test-key";
let server, jwksServer, base, privateKey, db;

// Tests swap this to control what the "LLM" returns.
const SAMPLE_PLAN = {
  summary: "Quick Korean-inspired week.",
  estimatedTotal: 72,
  model: "fake",
  meals: [
    { day: 1, slot: "dinner", name: "Bibimbap", servings: 1, prepMinutes: 25, leftoversFromDay: 0, ingredients: [
      { name: "jasmine rice", quantity: 150, unit: "g", category: "pantry" },
      { name: "eggs", quantity: 1, unit: "count", category: "dairy-eggs" },
      { name: "spinach", quantity: 100, unit: "g", category: "produce" },
    ] },
    { day: 2, slot: "breakfast", name: "Egg fried rice", servings: 1, prepMinutes: 10, leftoversFromDay: 0, ingredients: [
      { name: "Egg", quantity: 2, unit: "count", category: "dairy-eggs" },
      { name: "rice vinegar", quantity: 15, unit: "ml", category: "condiments-sauces" },
      { name: "peanuts", quantity: 20, unit: "g", category: "pantry" },
    ] },
  ],
};
let fakePlanner = async () => SAMPLE_PLAN;
const SAMPLE_RESEARCH = { items: [], total: 12.34, budget: 100, overBudget: false, warnings: [] };
let fakeResearcher = async () => SAMPLE_RESEARCH;
// Pretends the agent added everything.
const addAll = async (cartRun, save) => {
  cartRun.runs = [{ batch: 0, runId: "run-1", status: "COMPLETED", streamingUrl: "https://stream.example/1" }];
  for (const it of cartRun.items) (it.outcome = "added"), (it.quantityInCart = it.packages);
  cartRun.status = "built";
  cartRun.counts = { added: cartRun.items.length, outOfStock: 0, failed: 0, skipped: cartRun.skipped.length };
  save(cartRun);
  return cartRun;
};
let fakeCartBuilder = addAll;
const waitFor = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", r));

before(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  jwksServer = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await listen(jwksServer);

  db = openDb(":memory:");
  const app = createApp({
    authOptions: {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwksUri: `http://127.0.0.1:${jwksServer.address().port}/.well-known/jwks.json`,
      tokenSigningAlg: "RS256",
    },
    db,
    planner: (...args) => fakePlanner(...args),
    researcher: (...args) => fakeResearcher(...args),
    cartBuilder: (...args) => fakeCartBuilder(...args),
    log: { error() {} },
  });
  server = createServer(app);
  await listen(server);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  jwksServer?.close();
  db?.close();
});

const ALL = "read:profile write:profile";
function token(sub, { scope = ALL, aud = AUDIENCE, iss = ISSUER, key = privateKey, exp = "5m" } = {}) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

async function call(method, path, { tok, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(tok && { Authorization: `Bearer ${tok}` }),
      ...(body !== undefined && { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const goodProfile = {
  budget: 100,
  householdSize: 1,
  shoppingDays: 7,
  diet: "none",
  cuisines: ["Korean", "Italian"],
  allergies: ["peanuts"],
  avoid: ["snacks", "sugary drinks"],
  nutritionPrefs: ["high protein"],
  cookingPref: "quick",
  postalCode: "n6g 1a1",
  pantry: ["rice", "soy sauce"],
};

test("health is public", async () => {
  assert.equal((await call("GET", "/api/health")).status, 200);
});

test("profile without a token is 401", async () => {
  assert.equal((await call("GET", "/api/profile")).status, 401);
  assert.equal((await call("PUT", "/api/profile", { body: goodProfile })).status, 401);
});

test("tokens with wrong audience, issuer, signer, or expired are 401", async () => {
  const { privateKey: otherKey } = await generateKeyPair("RS256");
  for (const tok of [
    await token("auth0|a", { aud: "https://other-api" }),
    await token("auth0|a", { iss: "https://evil.example.com/" }),
    await token("auth0|a", { key: otherKey }),
    await token("auth0|a", { exp: Math.floor(Date.now() / 1000) - 60 }),
  ]) {
    assert.equal((await call("GET", "/api/profile", { tok })).status, 401);
  }
});

test("missing scope is 403", async () => {
  const readOnly = await token("auth0|a", { scope: "read:profile" });
  assert.equal((await call("GET", "/api/profile", { tok: readOnly })).status, 200);
  assert.equal((await call("PUT", "/api/profile", { tok: readOnly, body: goodProfile })).status, 403);
});

test("new user gets defaults, can save, and reload", async () => {
  const tok = await token("auth0|alice");
  const first = await call("GET", "/api/profile", { tok });
  assert.equal(first.status, 200);
  assert.equal(first.json.saved, false);
  assert.equal(first.json.profile.budget, 100);

  const put = await call("PUT", "/api/profile", { tok, body: goodProfile });
  assert.equal(put.status, 200);
  assert.equal(put.json.profile.postalCode, "N6G 1A1");

  const again = await call("GET", "/api/profile", { tok });
  assert.equal(again.json.saved, true);
  assert.deepEqual(again.json.profile.pantry, ["rice", "soy sauce"]);
});

test("profiles are isolated per user; body cannot pick the user", async () => {
  const alice = await token("auth0|iso-alice");
  const bob = await token("auth0|iso-bob");
  await call("PUT", "/api/profile", { tok: alice, body: { ...goodProfile, budget: 150 } });
  // Bob tries to smuggle a sub in the body: rejected as an unknown field.
  const smuggle = await call("PUT", "/api/profile", { tok: bob, body: { ...goodProfile, sub: "auth0|iso-alice" } });
  assert.equal(smuggle.status, 400);
  const bobView = await call("GET", "/api/profile", { tok: bob });
  assert.equal(bobView.json.saved, false);
  const aliceView = await call("GET", "/api/profile", { tok: alice });
  assert.equal(aliceView.json.profile.budget, 150);
});

test("invalid profiles are rejected with field errors", async () => {
  const tok = await token("auth0|val");
  const bad = await call("PUT", "/api/profile", {
    tok,
    body: { budget: -5, householdSize: 2.5, diet: "carnivore", postalCode: "12345", avoid: "snacks" },
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.json.fields).sort(), ["avoid", "budget", "diet", "householdSize", "postalCode"]);

  const malformed = await call("PUT", "/api/profile", { tok, body: "{not json" });
  assert.equal(malformed.status, 400);
});

// --- Shopping tasks ---------------------------------------------------------

test("tasks need a token and a saved profile", async () => {
  assert.equal((await call("POST", "/api/shopping-tasks", { body: {} })).status, 401);
  const tok = await token("auth0|no-profile");
  const res = await call("POST", "/api/shopping-tasks", { tok, body: {} });
  assert.equal(res.status, 409);
  assert.equal(res.json.error, "profile_required");
});

test("planning a task: 202, then planned with a consolidated list", async () => {
  const tok = await token("auth0|planner");
  await call("PUT", "/api/profile", { tok, body: goodProfile }); // pantry: rice, soy sauce; allergy: peanuts
  const created = await call("POST", "/api/shopping-tasks", { tok, body: { note: "more veggies" } });
  assert.equal(created.status, 202);
  assert.equal(created.json.task.status, "planning");
  assert.equal(created.json.task.input.note, "more veggies");

  const task = await waitFor(async () => {
    const r = await call("GET", `/api/shopping-tasks/${created.json.task.id}`, { tok });
    return r.json.task.status !== "planning" && r.json.task;
  });
  assert.equal(task.status, "planned");
  const names = task.result.toBuy.map((i) => i.name);
  // eggs merged across meals (1 + 2), rice covered by pantry, rice vinegar still bought, peanuts removed.
  assert.deepEqual(task.result.toBuy.find((i) => i.name === "eggs").quantities, [{ amount: 3, unit: "count" }]);
  assert.ok(names.includes("rice vinegar"));
  assert.ok(!names.includes("jasmine rice"));
  assert.equal(task.result.pantryCovered[0].name, "jasmine rice");
  assert.equal(task.result.removed[0].name, "peanuts");
  assert.ok(task.result.warnings.some((w) => w.type === "allergy"));

  const list = await call("GET", "/api/shopping-tasks", { tok });
  assert.equal(list.json.tasks[0].id, task.id);
});

test("only one plan at a time per user", async () => {
  const tok = await token("auth0|busy");
  await call("PUT", "/api/profile", { tok, body: goodProfile });
  let release;
  fakePlanner = () => new Promise((r) => (release = () => r(SAMPLE_PLAN)));
  try {
    assert.equal((await call("POST", "/api/shopping-tasks", { tok, body: {} })).status, 202);
    const second = await call("POST", "/api/shopping-tasks", { tok, body: {} });
    assert.equal(second.status, 409);
    assert.equal(second.json.error, "task_in_progress");
  } finally {
    release();
    fakePlanner = async () => SAMPLE_PLAN;
  }
});

test("planner failure marks the task failed without leaking details", async () => {
  const tok = await token("auth0|fails");
  await call("PUT", "/api/profile", { tok, body: goodProfile });
  fakePlanner = async () => { throw new Error("HTTP 503 secret-ish upstream detail"); };
  try {
    const created = await call("POST", "/api/shopping-tasks", { tok, body: {} });
    const task = await waitFor(async () => {
      const r = await call("GET", `/api/shopping-tasks/${created.json.task.id}`, { tok });
      return r.json.task.status !== "planning" && r.json.task;
    });
    assert.equal(task.status, "failed");
    assert.ok(!task.error.includes("503"));
  } finally {
    fakePlanner = async () => SAMPLE_PLAN;
  }
});

test("users cannot read each other's tasks", async () => {
  const owner = await token("auth0|task-owner");
  const other = await token("auth0|task-other");
  await call("PUT", "/api/profile", { tok: owner, body: goodProfile });
  const created = await call("POST", "/api/shopping-tasks", { tok: owner, body: {} });
  const id = created.json.task.id;
  assert.equal((await call("GET", `/api/shopping-tasks/${id}`, { tok: other })).status, 404);
  assert.equal((await call("GET", "/api/shopping-tasks/not-a-uuid", { tok: owner })).status, 404);
  assert.deepEqual((await call("GET", "/api/shopping-tasks", { tok: other })).json.tasks, []);
});

test("task input is validated", async () => {
  const tok = await token("auth0|task-val");
  await call("PUT", "/api/profile", { tok, body: goodProfile });
  const bad = await call("POST", "/api/shopping-tasks", { tok, body: { note: "x".repeat(501), sub: "auth0|other" } });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.json.fields).sort(), ["note", "sub"]);
});

// --- Pricing on T&T ---------------------------------------------------------

async function plannedTask(sub) {
  const tok = await token(sub);
  await call("PUT", "/api/profile", { tok, body: goodProfile });
  const created = await call("POST", "/api/shopping-tasks", { tok, body: {} });
  const id = created.json.task.id;
  await waitFor(async () => (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task.status === "planned");
  return { tok, id };
}
const settled = (tok, id) =>
  waitFor(async () => {
    const t = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
    return t.status !== "researching" && t;
  });

test("pricing a planned task: 202 → priced, plan kept", async () => {
  const { tok, id } = await plannedTask("auth0|pricer");
  let seen;
  fakeResearcher = async (toBuy, profile) => ((seen = { toBuy, profile }), SAMPLE_RESEARCH);
  try {
    const res = await call("POST", `/api/shopping-tasks/${id}/research`, { tok });
    assert.equal(res.status, 202);
    assert.equal(res.json.task.status, "researching");
    const task = await settled(tok, id);
    assert.equal(task.status, "priced");
    assert.equal(task.result.research.total, 12.34);
    assert.ok(task.result.meals.length > 0);
    assert.ok(seen.toBuy.some((i) => i.name === "eggs"));
    assert.equal(seen.profile.budget, 100);
    // Re-pricing a priced task is allowed.
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/research`, { tok })).status, 202);
    await settled(tok, id);
  } finally {
    fakeResearcher = async () => SAMPLE_RESEARCH;
  }
});

test("pricing failure returns the task to its previous state with a message", async () => {
  const { tok, id } = await plannedTask("auth0|price-fail");
  fakeResearcher = async () => { throw new Error("TinyFish fetch failed: SERVICE_BUSY"); };
  try {
    await call("POST", `/api/shopping-tasks/${id}/research`, { tok });
    const task = await settled(tok, id);
    assert.equal(task.status, "planned");
    assert.ok(task.result.toBuy.length > 0);
    assert.ok(task.error && !task.error.includes("SERVICE_BUSY"));
  } finally {
    fakeResearcher = async () => SAMPLE_RESEARCH;
  }
});

test("pricing: other users get 404, unfinished plans 409, one at a time", async () => {
  const { tok, id } = await plannedTask("auth0|price-owner");
  const other = await token("auth0|price-other");
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/research`, { tok: other })).status, 404);
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/research`)).status, 401);

  let release;
  fakeResearcher = () => new Promise((r) => (release = () => r(SAMPLE_RESEARCH)));
  try {
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/research`, { tok })).status, 202);
    const again = await call("POST", `/api/shopping-tasks/${id}/research`, { tok });
    assert.equal(again.status, 409);
    // A new plan can't start while pricing runs either.
    assert.equal((await call("POST", "/api/shopping-tasks", { tok, body: {} })).status, 409);
  } finally {
    release();
    fakeResearcher = async () => SAMPLE_RESEARCH;
  }
  await settled(tok, id);

  let hold;
  fakePlanner = () => new Promise((r) => (hold = () => r(SAMPLE_PLAN)));
  try {
    const tok2 = await token("auth0|price-early");
    await call("PUT", "/api/profile", { tok: tok2, body: goodProfile });
    const created = await call("POST", "/api/shopping-tasks", { tok: tok2, body: {} });
    const early = await call("POST", `/api/shopping-tasks/${created.json.task.id}/research`, { tok: tok2 });
    assert.equal(early.status, 409);
  } finally {
    hold();
    fakePlanner = async () => SAMPLE_PLAN;
  }
});

// --- Review screen ----------------------------------------------------------

const opt = (name, packPrice, packages = 1) => ({
  name, packPrice, packages, cost: Math.round(packPrice * packages * 100) / 100,
  url: `https://www.tntsupermarket.com/eng/1234-${name.toLowerCase().replace(/\W+/g, "-")}.html`, flags: [],
});
// Research shaped like research.js output, built from whatever list it's given.
const reviewResearcher = async (toBuy) => ({
  items: toBuy.map((it) => it.searchTerm === "nothing here"
    ? { name: it.name, category: it.category, quantities: it.quantities, status: "not_found", query: it.searchTerm, chosen: null, alternatives: [], excluded: [] }
    : {
      name: it.name, category: it.category, quantities: it.quantities, status: "matched", query: it.searchTerm,
      chosen: opt(`${it.searchTerm} A`, 2.5, 2), alternatives: [opt(`${it.searchTerm} B`, 4)], excluded: [],
    }),
  total: 0, budget: 100, overBudget: false, warnings: [],
});

async function pricedTask(sub) {
  const { tok, id } = await plannedTask(sub);
  fakeResearcher = reviewResearcher;
  await call("POST", `/api/shopping-tasks/${id}/research`, { tok });
  const task = await settled(tok, id);
  assert.equal(task.status, "priced");
  return { tok, id, task };
}

test("priced task comes with a server-computed review", async () => {
  const { tok, id } = await pricedTask("auth0|review-get");
  const { task } = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json;
  const n = task.result.research.items.length;
  assert.equal(task.result.selections.length, n);
  assert.equal(task.review.itemCount, n);
  assert.equal(task.review.total, Math.round(n * 5 * 100) / 100); // 2 packs × $2.50 each
});

test("PATCH cart: swap, pack count, remove — totals come from the server", async () => {
  const { tok, id, task } = await pricedTask("auth0|review-edit");
  const [a, b] = task.result.research.items;
  const res = await call("PATCH", `/api/shopping-tasks/${id}/cart`, {
    tok,
    body: { edits: [{ index: 0, name: a.name, option: 1, packages: 3 }, { index: 1, name: b.name, removed: true }] },
  });
  assert.equal(res.status, 200);
  const lines = res.json.task.review.lines;
  assert.equal(lines[0].cost, 12); // 3 × $4
  assert.equal(lines[1].removed, true);
  // Persisted.
  const again = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
  assert.deepEqual(again.result.selections[0], { option: 1, packages: 3, removed: false });
  assert.equal(again.review.total, res.json.task.review.total);
});

test("PATCH cart rejects prices from the client, bad edits, other users, and unpriced tasks", async () => {
  const { tok, id, task } = await pricedTask("auth0|review-bad");
  const name = task.result.research.items[0].name;
  const price = await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 0, name, packPrice: 0.01 }] } });
  assert.equal(price.status, 400);
  assert.equal(price.json.fields[0].field, "packPrice");
  assert.equal((await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 0, name, option: 7 }] } })).status, 400);
  assert.equal((await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [], total: 1 } })).status, 400);
  const other = await token("auth0|review-intruder");
  assert.equal((await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok: other, body: { edits: [{ index: 0, name, removed: true }] } })).status, 404);
  const { tok: t2, id: planned } = await plannedTask("auth0|review-unpriced");
  assert.equal((await call("PATCH", `/api/shopping-tasks/${planned}/cart`, { tok: t2, body: { edits: [{ index: 0, name: "eggs", removed: true }] } })).status, 409);
});

test("search again replaces one item's options and resets its selection", async () => {
  const { tok, id, task } = await pricedTask("auth0|review-search");
  const name = task.result.research.items[0].name;
  await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 0, name, option: 1, packages: 5 }] } });
  const res = await call("POST", `/api/shopping-tasks/${id}/items/0/search`, { tok, body: { query: "silken tofu" } });
  assert.equal(res.status, 200);
  assert.equal(res.json.found, true);
  const item = res.json.task.result.research.items[0];
  assert.equal(item.name, name);
  assert.equal(item.query, "silken tofu");
  assert.equal(item.chosen.name, "silken tofu A");
  assert.deepEqual(res.json.task.result.selections[0], { option: 0, packages: 2, removed: false });
});

test("search again: not found keeps the old pick; validation; busy lock", async () => {
  const { tok, id, task } = await pricedTask("auth0|review-search2");
  const before = task.result.research.items[0].chosen.name;
  const miss = await call("POST", `/api/shopping-tasks/${id}/items/0/search`, { tok, body: { query: "nothing here" } });
  assert.equal(miss.json.found, false);
  assert.equal(miss.json.task.result.research.items[0].chosen.name, before);
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/items/0/search`, { tok, body: { query: "" } })).status, 400);
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/items/99/search`, { tok, body: { query: "x" } })).status, 404);

  let release;
  fakeResearcher = () => new Promise((r) => (release = () => r(reviewResearcher([{ name: "x", searchTerm: "slow" }]))));
  try {
    const pending = call("POST", `/api/shopping-tasks/${id}/items/0/search`, { tok, body: { query: "slow" } });
    await waitFor(() => release);
    const name = task.result.research.items[1].name;
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/items/1/search`, { tok, body: { query: "x" } })).status, 409);
    assert.equal((await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 1, name, removed: true }] } })).status, 409);
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/research`, { tok })).status, 409);
    release();
    assert.equal((await pending).status, 200);
  } finally {
    fakeResearcher = reviewResearcher;
  }
});

test("re-pricing the whole list keeps removals", async () => {
  const { tok, id, task } = await pricedTask("auth0|review-reprice");
  const name = task.result.research.items[1].name;
  await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 1, name, removed: true }] } });
  await call("POST", `/api/shopping-tasks/${id}/research`, { tok });
  const after = await settled(tok, id);
  assert.equal(after.result.selections[1].removed, true);
  fakeResearcher = async () => SAMPLE_RESEARCH;
});

// --- Approve & build cart ----------------------------------------------------

const CART_SCOPES = "read:profile write:profile build:cart";
const approveBody = (task) => ({ expectedTotal: task.review.total, expectedItems: task.review.itemCount });
const built = (tok, id) =>
  waitFor(async () => {
    const t = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
    return t.status !== "building" && t;
  });

test("build-cart needs the build:cart permission", async () => {
  const { tok, id } = await pricedTask("auth0|cart-noscope");
  const task = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
  const res = await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: approveBody(task) });
  assert.equal(res.status, 403);
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart`, { body: approveBody(task) })).status, 401);
});

test("approve → building → built, approval recorded, skipped lines listed", async () => {
  const { id, task: priced } = await pricedTask("auth0|cart-ok");
  const tok = await token("auth0|cart-ok", { scope: CART_SCOPES });
  const name = priced.result.research.items[1].name;
  await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 1, name, removed: true }] } });
  const task = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;

  let seen;
  fakeCartBuilder = async (cartRun, save) => ((seen = structuredClone(cartRun)), addAll(cartRun, save));
  try {
    const res = await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: approveBody(task) });
    assert.equal(res.status, 202);
    assert.equal(res.json.task.status, "building");
    const done = await built(tok, id);
    assert.equal(done.status, "built");
    const run = done.result.cartRun;
    assert.equal(run.status, "built");
    assert.equal(run.approval.sub, "auth0|cart-ok");
    assert.equal(run.approval.scope, "build:cart");
    assert.equal(run.approval.total, task.review.total);
    assert.equal(run.items.length, task.review.itemCount);
    assert.deepEqual(run.skipped, [{ index: 1, name, reason: "removed" }]);
    // The agent got the reviewed product URLs and pack counts.
    const line0 = task.review.lines[0];
    assert.deepEqual([seen.items[0].url, seen.items[0].packages], [line0.product.url, line0.packages]);
    // A built task still shows its review.
    assert.equal(done.review.total, task.review.total);
  } finally {
    fakeCartBuilder = addAll;
  }
});

test("build-cart rejects a stale review, other users, and bad bodies", async () => {
  const { id } = await pricedTask("auth0|cart-stale");
  const tok = await token("auth0|cart-stale", { scope: CART_SCOPES });
  const task = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
  const stale = await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: { ...approveBody(task), expectedTotal: task.review.total + 1 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, "stale_review");
  const count = await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: { ...approveBody(task), expectedItems: 99 } });
  assert.equal(count.json.error, "stale_review");
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: { expectedTotal: "1" } })).status, 400);
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: { ...approveBody(task), sub: "x" } })).status, 400);
  const other = await token("auth0|cart-intruder", { scope: CART_SCOPES });
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok: other, body: approveBody(task) })).status, 404);
});

test("build-cart: unpriced tasks 409, one build at a time, edits after a build return to priced", async () => {
  const { tok: t1, id: planned } = await plannedTask("auth0|cart-early");
  const early = await token("auth0|cart-early", { scope: CART_SCOPES });
  assert.equal((await call("POST", `/api/shopping-tasks/${planned}/build-cart`, { tok: early, body: { expectedTotal: 0, expectedItems: 0 } })).status, 409);
  void t1;

  const { id } = await pricedTask("auth0|cart-once");
  const tok = await token("auth0|cart-once", { scope: CART_SCOPES });
  const task = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
  let release;
  fakeCartBuilder = (cartRun, save) => new Promise((r) => (release = () => r(addAll(cartRun, save))));
  try {
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: approveBody(task) })).status, 202);
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: approveBody(task) })).status, 409);
    const name = task.result.research.items[0].name;
    assert.equal((await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 0, name, removed: true }] } })).status, 409);
    release();
    await built(tok, id);
  } finally {
    fakeCartBuilder = addAll;
  }
  // Rebuild is allowed; editing a built cart sends it back to review.
  const name = task.result.research.items[0].name;
  const edited = await call("PATCH", `/api/shopping-tasks/${id}/cart`, { tok, body: { edits: [{ index: 0, name, packages: 4 }] } });
  assert.equal(edited.json.task.status, "priced");
  assert.equal(edited.json.task.result.cartRun.status, "built"); // last build kept for reference
});

test("a build that can't start restores the previous state with a message", async () => {
  const { id } = await pricedTask("auth0|cart-fail");
  const tok = await token("auth0|cart-fail", { scope: CART_SCOPES });
  const task = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
  fakeCartBuilder = async () => { throw Object.assign(new Error("402 raw detail"), { userMessage: "The TinyFish wallet is out of funds." }); };
  try {
    await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: approveBody(task) });
    const after = await built(tok, id);
    assert.equal(after.status, "priced");
    assert.equal(after.error, "The TinyFish wallet is out of funds.");
  } finally {
    fakeCartBuilder = addAll;
  }
});

test("cancel: stops a running build; 404 for others; 409 when nothing is running", async () => {
  const { id } = await pricedTask("auth0|cart-cancel");
  const tok = await token("auth0|cart-cancel", { scope: CART_SCOPES });
  const task = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
  assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart/cancel`, { tok })).status, 409);

  let gotSignal;
  fakeCartBuilder = (cartRun, save, signal) =>
    new Promise((resolve) => {
      gotSignal = signal;
      signal.addEventListener("abort", () => {
        for (const it of cartRun.items) (it.outcome = "cancelled"), (it.note = "Stopped before this item.");
        cartRun.status = "cancelled";
        save(cartRun);
        resolve(cartRun);
      });
    });
  try {
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: approveBody(task) })).status, 202);
    const other = await token("auth0|cart-cancel-other");
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart/cancel`, { tok: other })).status, 404);
    // Plain read:profile is enough to stop the agent (no consent popup needed).
    const plain = await token("auth0|cart-cancel");
    const res = await call("POST", `/api/shopping-tasks/${id}/build-cart/cancel`, { tok: plain });
    assert.equal(res.status, 202);
    assert.equal(gotSignal.aborted, true);
    const done = await built(tok, id);
    assert.equal(done.status, "built");
    assert.equal(done.result.cartRun.status, "cancelled");
    assert.equal((await call("POST", `/api/shopping-tasks/${id}/build-cart/cancel`, { tok })).status, 409);
  } finally {
    fakeCartBuilder = addAll;
  }
});

test("store stock is learned from a cart build and used on the next price search", async () => {
  const { id, task: priced } = await pricedTask("auth0|stock-loop");
  const tok = await token("auth0|stock-loop", { scope: CART_SCOPES });
  const task = (await call("GET", `/api/shopping-tasks/${id}`, { tok })).json.task;
  const first = task.result.research.items[0];

  // The agent finds the first item's pick out of stock at the user's (N6G) store.
  fakeCartBuilder = async (cartRun, save) => {
    for (const it of cartRun.items) it.outcome = it.url === first.chosen.url ? "out_of_stock" : "added";
    cartRun.status = "partial";
    save(cartRun);
    return cartRun;
  };
  try {
    await call("POST", `/api/shopping-tasks/${id}/build-cart`, { tok, body: approveBody(task) });
    await built(tok, id);
  } finally {
    fakeCartBuilder = addAll;
  }

  // Re-pricing (same catalogue results) now steers to the alternative.
  fakeResearcher = reviewResearcher;
  await call("POST", `/api/shopping-tasks/${id}/research`, { tok });
  const after = await settled(tok, id);
  const item = after.result.research.items[0];
  assert.equal(item.chosen.name, first.alternatives[0].name);
  assert.ok(item.chosen.flags.includes("store-swapped"));
  assert.equal(after.result.research.store.fsa, "N6G");
  assert.ok(after.result.research.warnings.some((w) => w.type === "store-stock"));
  void priced;
  fakeResearcher = async () => SAMPLE_RESEARCH;
});
