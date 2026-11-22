import express from "express";
import cors from "cors";
import { auth, requiredScopes } from "express-oauth2-jwt-bearer";
import { validateProfile, DEFAULT_PROFILE } from "./profile.js";
import { validateTaskInput, startPlanningTask, startResearchTask, startCartBuild, cancelCartBuild, selectionsOf, withReview } from "./tasks.js";
import { applyEdits, defaultSelection, summarize } from "./review/cart.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const SCOPES = {
  readProfile: "read:profile",
  writeProfile: "write:profile",
  // Lets CartPilot's agent change the user's real T&T cart. Requested by the
  // browser only at the moment the user approves (step-up consent).
  buildCart: "build:cart",
};

/**
 * Build the Express app.
 * @param {object} opts
 * @param {object} opts.authOptions  options for express-oauth2-jwt-bearer `auth()`
 *        (production: { issuerBaseURL, audience }; tests inject a local key).
 * @param {object} opts.db           store from openDb()
 * @param {Function} opts.planner    async (profile, note) => plan (see planner/mealPlan.js)
 * @param {Function} opts.researcher async (toBuy, profile) => research (see research/research.js)
 * @param {Function|null} opts.cartBuilder async (cartRun, save) => cartRun (see cart/buildCart.js); null disables cart building
 * @param {string[]} [opts.corsOrigins]
 */
export function createApp({ authOptions, db, planner, researcher, cartBuilder = null, corsOrigins = [], log = console }) {
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

  // Tasks with a single-item T&T search in flight (in memory; cleared on restart).
  const busy = new Set();
  const loadPriced = (req, res) => {
    const sub = userSub(req);
    const task = UUID_RE.test(req.params.id) ? db.getTask(sub, req.params.id) : null;
    if (!task) return void res.status(404).json({ error: "not_found" });
    if (task.status !== "priced" && task.status !== "built") {
      const message = task.status === "building"
        ? "The agent is building your cart. Wait for it to finish."
        : "Find T&T prices for this plan first.";
      return void res.status(409).json({ error: "not_priced", message });
    }
    if (busy.has(`${sub}:${task.id}`)) {
      return void res.status(409).json({ error: "search_in_progress", message: "Wait for the current search to finish." });
    }
    return { sub, task };
  };

  // --- Shopping tasks (meal plan → shopping list → T&T prices → review) ---
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
    res.json({ task: withReview(task) });
  });

  // Look up and price the task's shopping list on T&T (read-only web research;
  // nothing is added to any cart here).
  api.post("/shopping-tasks/:id/research", requiredScopes(SCOPES.readProfile), (req, res) => {
    const sub = userSub(req);
    const task = UUID_RE.test(req.params.id) ? db.getTask(sub, req.params.id) : null;
    if (!task) return res.status(404).json({ error: "not_found" });
    if (!["planned", "priced", "built"].includes(task.status)) {
      return res.status(409).json({ error: "not_ready", message: "This plan isn't ready to price yet." });
    }
    if (!task.result?.toBuy?.length) {
      return res.status(409).json({ error: "empty_list", message: "There's nothing on this shopping list to price." });
    }
    if (busy.has(`${sub}:${task.id}`) || db.activeTaskCount(sub) > 0 || !db.claimResearch(sub, task.id)) {
      return res.status(409).json({ error: "task_in_progress", message: "Something is already running. Wait for it to finish." });
    }
    const { updatedAt: _ignored, ...profile } = db.getProfile(sub) ?? task.input.profile;
    startResearchTask({ db, researcher, sub, task, profile, log });
    res.status(202).json({ task: db.getTask(sub, task.id) });
  });

  // Review edits: swap option, change pack count, remove/restore. Prices are
  // recomputed from the stored research; the client only sends choices.
  api.patch("/shopping-tasks/:id/cart", requiredScopes(SCOPES.readProfile), (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => k !== "edits")) {
      return res.status(400).json({ error: "invalid_edits", fields: [{ field: "body", message: "expected { edits: [...] }" }] });
    }
    const loaded = loadPriced(req, res);
    if (!loaded) return;
    const { sub, task } = loaded;
    const { selections, errors } = applyEdits(task.result.research, selectionsOf(task.result), body.edits);
    if (errors) return res.status(400).json({ error: "invalid_edits", fields: errors });
    db.setTaskState(sub, task.id, { status: "priced", result: { ...task.result, selections } });
    res.json({ task: withReview(db.getTask(sub, task.id)) });
  });

  // Search T&T again for one item with the user's own words (one TinyFish
  // fetch, ~25–40s). Waits for the result.
  api.post("/shopping-tasks/:id/items/:index/search", requiredScopes(SCOPES.readProfile), async (req, res, next) => {
    const body = req.body ?? {};
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (Object.keys(body).some((k) => k !== "query") || query.length < 1 || query.length > 60) {
      return res.status(400).json({ error: "invalid_query", message: "Enter 1–60 characters to search for." });
    }
    const loaded = loadPriced(req, res);
    if (!loaded) return;
    const { sub, task } = loaded;
    const index = Number(req.params.index);
    const item = Number.isInteger(index) ? task.result.research.items[index] : undefined;
    if (!item) return res.status(404).json({ error: "not_found" });
    if (db.activeTaskCount(sub) > 0) {
      return res.status(409).json({ error: "task_in_progress", message: "Something is already running. Wait for it to finish." });
    }

    const key = `${sub}:${task.id}`;
    busy.add(key);
    try {
      const { updatedAt: _ignored, ...profile } = db.getProfile(sub) ?? task.input.profile;
      const one = await researcher([{ name: item.name, category: item.category, quantities: item.quantities, searchTerm: query }], profile);
      const found = one.items?.[0];
      const current = db.getTask(sub, task.id);
      if (!found?.chosen) {
        return res.json({ task: withReview(current), found: false, message: `Nothing on T&T matched “${query}”. Your previous pick is unchanged.` });
      }
      const research = { ...current.result.research, items: [...current.result.research.items] };
      research.items[index] = { ...item, status: found.status, query: found.query, chosen: found.chosen, alternatives: found.alternatives, excluded: found.excluded };
      const selections = [...selectionsOf(current.result)];
      selections[index] = defaultSelection(research.items[index]);
      db.setTaskState(sub, task.id, { status: "priced", result: { ...current.result, research, selections } });
      res.json({ task: withReview(db.getTask(sub, task.id)), found: true });
    } catch (err) {
      log.error(`[task ${task.id}] item search failed:`, err.message);
      res.status(502).json({ error: "search_failed", message: "Couldn't reach T&T. Try again in a moment." });
    } finally {
      busy.delete(key);
    }
  });

  // Approve & build cart. Needs the build:cart permission, which the browser
  // asks for only when the user approves. The client must echo the total and
  // item count it showed, so the agent only gets exactly what was approved.
  api.post("/shopping-tasks/:id/build-cart", requiredScopes(SCOPES.buildCart), (req, res) => {
    if (!cartBuilder) {
      return res.status(503).json({ error: "cart_building_disabled", message: "Cart building isn't set up on this server." });
    }
    const body = req.body ?? {};
    const keysOk = Object.keys(body).every((k) => k === "expectedTotal" || k === "expectedItems");
    if (!keysOk || typeof body.expectedTotal !== "number" || !Number.isInteger(body.expectedItems)) {
      return res.status(400).json({ error: "invalid_approval", message: "Send { expectedTotal, expectedItems } from the review you approved." });
    }
    const loaded = loadPriced(req, res);
    if (!loaded) return;
    const { sub, task } = loaded;
    const review = summarize(task.result.research, selectionsOf(task.result), task.result.research.budget);
    if (Math.abs(review.total - body.expectedTotal) > 0.005 || review.itemCount !== body.expectedItems) {
      return res.status(409).json({ error: "stale_review", message: "Your cart changed since you reviewed it. Please check it and approve again." });
    }
    if (review.readyForAgent === 0) {
      return res.status(409).json({ error: "nothing_to_add", message: "None of the items can be added by the agent (no product links)." });
    }
    if (db.activeTaskCount(sub) > 0 || !db.claimBuild(sub, task.id)) {
      return res.status(409).json({ error: "task_in_progress", message: "Something is already running. Wait for it to finish." });
    }
    const approval = {
      sub,
      approvedAt: new Date().toISOString(),
      scope: SCOPES.buildCart,
      total: review.total,
      itemCount: review.itemCount,
    };
    startCartBuild({ db, cartBuilder, sub, task, review, approval, log });
    res.status(202).json({ task: withReview(db.getTask(sub, task.id)) });
  });

  // Stop the agent. Only needs read:profile: stopping is always safe and must
  // never wait on a consent popup. Items already added stay in the T&T cart.
  api.post("/shopping-tasks/:id/build-cart/cancel", requiredScopes(SCOPES.readProfile), (req, res) => {
    const sub = userSub(req);
    const task = UUID_RE.test(req.params.id) ? db.getTask(sub, req.params.id) : null;
    if (!task) return res.status(404).json({ error: "not_found" });
    if (task.status !== "building" || !cancelCartBuild(sub, task.id)) {
      return res.status(409).json({ error: "not_building", message: "The agent isn't running." });
    }
    res.status(202).json({ task: withReview(db.getTask(sub, task.id)) });
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
