import express from "express";
import cors from "cors";
import { auth, requiredScopes } from "express-oauth2-jwt-bearer";
import { validateProfile, DEFAULT_PROFILE } from "./profile.js";

export const SCOPES = {
  readProfile: "read:profile",
  writeProfile: "write:profile",
};

/**
 * Build the Express app.
 * @param {object} opts
 * @param {object} opts.authOptions  options for express-oauth2-jwt-bearer `auth()`
 *        (production: { issuerBaseURL, audience }; tests inject a local key).
 * @param {object} opts.db           store from openDb()
 * @param {string[]} [opts.corsOrigins]
 */
export function createApp({ authOptions, db, corsOrigins = [] }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: corsOrigins, allowedHeaders: ["Authorization", "Content-Type"] }));
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Everything below requires a valid Auth0 access token for this API.
  const checkJwt = auth(authOptions);
  const api = express.Router();
  api.use(checkJwt);

  // The user id ALWAYS comes from the verified token, never from the request.
  const userSub = (req) => req.auth.payload.sub;

  api.get("/profile", requiredScopes(SCOPES.readProfile), (req, res) => {
    const profile = db.getProfile(userSub(req));
    res.json({ profile: profile ?? { ...DEFAULT_PROFILE }, saved: Boolean(profile) });
  });

  api.put("/profile", requiredScopes(SCOPES.writeProfile), (req, res) => {
    const { value, errors } = validateProfile(req.body);
    if (errors) return res.status(400).json({ error: "invalid_profile", fields: errors });
    const profile = db.saveProfile(userSub(req), value);
    res.json({ profile, saved: true });
  });

  app.use("/api", api);

  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

  // Auth errors from express-oauth2-jwt-bearer carry a status (401/403).
  // Never echo token contents; just the error code.
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "invalid_json" });
    }
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) console.error(err);
    res
      .status(status)
      .json({ error: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status >= 500 ? "server_error" : err.code ?? "error" });
  });

  return app;
}
