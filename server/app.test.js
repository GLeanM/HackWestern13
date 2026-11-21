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
