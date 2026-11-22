import { createApp } from "./app.js";
import { openDb } from "./db.js";
import { createGeminiPlanner } from "./planner/mealPlan.js";
import { fetchPages } from "./research/tinyfish.js";
import { researchList } from "./research/research.js";
import { createAgentClient } from "./cart/agent.js";
import { runCartBuild } from "./cart/buildCart.js";

const domain = process.env.AUTH0_DOMAIN ?? process.env.VITE_AUTH0_DOMAIN;
const audience = process.env.AUTH0_AUDIENCE ?? process.env.VITE_AUTH0_AUDIENCE;
const port = Number(process.env.API_PORT ?? 3001);

const missing = [
  !domain && "AUTH0_DOMAIN (or VITE_AUTH0_DOMAIN)",
  !audience && "AUTH0_AUDIENCE (or VITE_AUTH0_AUDIENCE)",
  !process.env.GEMINI_API_KEY && "GEMINI_API_KEY",
  !process.env.TINYFISH_API_KEY && "TINYFISH_API_KEY",
].filter(Boolean);
if (missing.length) {
  console.error(`Missing env: ${missing.join(", ")}. Add them to .env.local.`);
  process.exit(1);
}

const db = openDb(process.env.DB_PATH ?? "data/cartpilot.db");
const app = createApp({
  authOptions: {
    issuerBaseURL: `https://${domain}/`,
    audience,
    tokenSigningAlg: "RS256",
  },
  db,
  planner: createGeminiPlanner({
    apiKey: process.env.GEMINI_API_KEY,
    models: (process.env.GEMINI_MODELS ?? "gemini-3.5-flash,gemini-flash-latest").split(",").map((s) => s.trim()),
    thinkingLevel: process.env.GEMINI_THINKING ?? "low",
  }),
  researcher: (toBuy, profile) =>
    researchList(toBuy, profile, {
      fetchPages: (urls) => fetchPages(urls, { apiKey: process.env.TINYFISH_API_KEY }),
    }),
  // The T&T-signed-in TinyFish Browser Context Profile. Without it the
  // approve route answers 503 instead of crashing the server.
  cartBuilder: process.env.TINYFISH_PROFILE_ID
    ? (cartRun, save, signal) =>
        runCartBuild(cartRun, {
          agent: createAgentClient({ apiKey: process.env.TINYFISH_API_KEY }),
          profileId: process.env.TINYFISH_PROFILE_ID,
          save,
          signal,
          // CART_AGENT_CONCURRENCY=1 forces one agent at a time (max 2: the TinyFish wallet limit).
          concurrency: Math.max(1, Math.min(2, Number(process.env.CART_AGENT_CONCURRENCY) || 2)),
        })
    : null,
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),
});

// Stop TinyFish runs left over from a build that a restart interrupted.
if (db.interruptedRunIds.length && process.env.TINYFISH_API_KEY) {
  const agent = createAgentClient({ apiKey: process.env.TINYFISH_API_KEY });
  for (const id of db.interruptedRunIds) {
    agent.cancelRun(id).then(
      (status) => console.log(`Cancelled leftover TinyFish run ${id} (${status})`),
      (err) => console.error(`Couldn't cancel leftover TinyFish run ${id}:`, err.message),
    );
  }
}

if (!process.env.TINYFISH_PROFILE_ID) {
  console.warn("TINYFISH_PROFILE_ID is not set: 'Approve & build cart' is disabled.");
}

app.listen(port, () => {
  console.log(`CartPilot API on http://localhost:${port} (audience ${audience})`);
});
