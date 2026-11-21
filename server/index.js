import { createApp } from "./app.js";
import { openDb } from "./db.js";

const domain = process.env.AUTH0_DOMAIN ?? process.env.VITE_AUTH0_DOMAIN;
const audience = process.env.AUTH0_AUDIENCE ?? process.env.VITE_AUTH0_AUDIENCE;
const port = Number(process.env.API_PORT ?? 3001);

const missing = [
  !domain && "AUTH0_DOMAIN (or VITE_AUTH0_DOMAIN)",
  !audience && "AUTH0_AUDIENCE (or VITE_AUTH0_AUDIENCE)",
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
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),
});

app.listen(port, () => {
  console.log(`CartPilot API on http://localhost:${port} (audience ${audience})`);
});
