import express from "express";
import cors from "cors";
import { auth, requiredScopes } from "express-oauth2-jwt-bearer";
import { validateProfile, DEFAULT_PROFILE } from "./profile.js";
import { validateTaskInput, startPlanningTask, startResearchTask } from "./tasks.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
 * @param {Function} opts.planner    async (profile, note) => plan (see planner/mealPlan.js)
 * @param {Function} opts.researcher async (toBuy, profile) => research (see research/research.js)
 * @param {string[]} [opts.corsOrigins]
 */
export function createApp({ authOptions, db, planner, researcher, corsOrigins = [], log = console }) {
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

  // --- Shopping tasks (meal plan → shopping list; later: products and cart) ---
  // Planning reads the user's profile, so it needs read:profile. The scope that
  // lets the agent touch the real cart (build:cart) is reserved for that step.

  api.post("/shopping-tasks", requiredScopes(SCOPES.readProfile), (req, res) => {
    const sub = userSub(req);
    const { value, errors } = validateTaskInput(req.body);
    if (errors) return res.status(400).json({ error: "invalid_task", fields: errors });
    const stored = db.getProfile(sub);
    if (!stored) return res.status(409).json({ error: "profile_required", message: "Save your profile first." });
    if (db.activeTaskCount(sub) > 0) {
      return res.status(409).json({ error: "task_in_progress", message: "A plan is already being made. Wait for it to finish." });
    }
    const { updatedAt: _ignored, ...profile } = stored;
    const task = startPlanningTask({ db, planner, sub, profile, note: value.note, log });
    res.status(202).location(`/api/shopping-tasks/${task.id}`).json({ task });
  });

  api.get("/shopping-tasks", requiredScopes(SCOPES.readProfile), (req, res) => {
    const tasks = db.listTasks(userSub(req)).map(({ id, status, createdAt, updatedAt, result }) => ({
      id, status, createdAt, updatedAt, summary: result?.summary ?? null,
    }));
    res.json({ tasks });
  });

  api.get("/shopping-tasks/:id", requiredScopes(SCOPES.readProfile), (req, res) => {
    // 404 (not 403) for other users' tasks so ids can't be probed.
    const task = UUID_RE.test(req.params.id) ? db.getTask(userSub(req), req.params.id) : null;
    if (!task) return res.status(404).json({ error: "not_found" });
    res.json({ task });
  });

  // Look up and price the task's shopping list on T&T (read-only web research;
  // nothing is added to any cart here).
  api.post("/shopping-tasks/:id/research", requiredScopes(SCOPES.readProfile), (req, res) => {
    const sub = userSub(req);
    const task = UUID_RE.test(req.params.id) ? db.getTask(sub, req.params.id) : null;
    if (!task) return res.status(404).json({ error: "not_found" });
    if (task.status !== "planned" && task.status !== "priced") {
      return res.status(409).json({ error: "not_ready", message: "This plan isn't ready to price yet." });
    }
    if (!task.result?.toBuy?.length) {
      return res.status(409).json({ error: "empty_list", message: "There's nothing on this shopping list to price." });
    }
    if (db.activeTaskCount(sub) > 0 || !db.claimResearch(sub, task.id)) {
      return res.status(409).json({ error: "task_in_progress", message: "Something is already running. Wait for it to finish." });
    }
    const { updatedAt: _ignored, ...profile } = db.getProfile(sub) ?? task.input.profile;
    startResearchTask({ db, researcher, sub, task, profile, log });
    res.status(202).json({ task: db.getTask(sub, task.id) });
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
    if (status >= 500) log.error(err);
    res
      .status(status)
      .json({ error: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status >= 500 ? "server_error" : err.code ?? "error" });
  });

  return app;
}
