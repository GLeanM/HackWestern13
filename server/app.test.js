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
