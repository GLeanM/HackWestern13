import { randomUUID } from "node:crypto";
import { consolidate } from "./planner/consolidate.js";
import { carryOver, defaultSelections, summarize } from "./review/cart.js";
import { planCartRun } from "./cart/buildCart.js";

const MAX_NOTE = 500;

export function validateTaskInput(body) {
  const input = body ?? {};
  if (typeof input !== "object" || Array.isArray(input)) return { errors: { body: "must be a JSON object" } };
  const errors = {};
  for (const key of Object.keys(input)) if (key !== "note") errors[key] = "unknown field";
  const note = input.note ?? "";
  if (typeof note !== "string") errors.note = "must be a string";
  else if (note.length > MAX_NOTE) errors.note = `${MAX_NOTE} characters or fewer`;
  return Object.keys(errors).length ? { errors } : { value: { note: note.trim() } };
}

/**
 * Creates a task and plans it in the background. Returns the task row
 * immediately (status "planning"); the client polls GET /shopping-tasks/:id.
 */
export function startPlanningTask({ db, planner, sub, profile, note, log = console }) {
  const id = randomUUID();
  const task = db.createTask(sub, id, { note, profile });

  (async () => {
    try {
      const plan = await planner(profile, note);
      const list = consolidate(plan, profile);
      db.completeTask(sub, id, {
        summary: plan.summary,
        estimatedTotal: plan.estimatedTotal,
        model: plan.model,
        meals: plan.meals,
        ...list,
      });
    } catch (err) {
      log.error(`[task ${id}] planning failed:`, err.message);
      db.failTask(sub, id, "The meal planner couldn't finish. Please try again in a moment.");
    }
  })();

  return task;
}

/**
 * Prices a planned task's shopping list on T&T in the background.
 * Caller must have claimed the task (db.claimResearch) first. On failure the
 * task returns to its previous state so the plan (and any old prices) survive.
 */
export function startResearchTask({ db, researcher, sub, task, profile, log = console }) {
  const plan = task.result;
  const previousStatus = task.status; // "planned", "priced" or "built"
  db.setTaskState(sub, task.id, { status: "researching", result: plan });

  (async () => {
    try {
      const research = await researcher(plan.toBuy, profile);
      // Re-pricing keeps the user's review decisions where they still apply.
      const selections = plan.research
        ? carryOver(plan.research, plan.selections, research)
        : defaultSelections(research);
      db.setTaskState(sub, task.id, { status: "priced", result: { ...plan, research, selections } });
    } catch (err) {
      log.error(`[task ${task.id}] pricing failed:`, err.message);
      db.setTaskState(sub, task.id, {
        status: previousStatus,
        result: plan,
        error: "Couldn't reach T&T to check prices. Please try again in a moment.",
      });
    }
  })();
}

/** Selections for a priced task (older tasks priced before reviews existed get defaults). */
export function selectionsOf(result) {
  const sel = result?.selections;
  return Array.isArray(sel) && sel.length === result.research.items.length ? sel : defaultSelections(result.research);
}

/** Adds the server-computed review (lines, total, warnings) to a priced task. */
export function withReview(task) {
  if (!task || !["priced", "building", "built"].includes(task.status) || !task.result?.research) return task;
  const selections = selectionsOf(task.result);
  return {
    ...task,
    result: { ...task.result, selections },
    review: summarize(task.result.research, selections, task.result.research.budget),
  };
}

/**
 * Runs the TinyFish agent that adds the approved review to the user's T&T
 * cart. Caller must have claimed the task (db.claimBuild). Progress (live
 * browser URLs, per-item outcomes) is saved as it happens.
 */
// Builds in progress, so the user can stop them: "sub:taskId" → AbortController.
const activeBuilds = new Map();

/** Ask a running build to stop. Returns false if there's nothing to stop. */
export function cancelCartBuild(sub, taskId) {
  const ctl = activeBuilds.get(`${sub}:${taskId}`);
  if (!ctl) return false;
  ctl.abort();
  return true;
}

export function startCartBuild({ db, cartBuilder, sub, task, review, approval, log = console }) {
  const previousStatus = task.status; // "priced" or "built"
  const cartRun = planCartRun(review, approval);
  const key = `${sub}:${task.id}`;
  const controller = new AbortController();
  activeBuilds.set(key, controller);
  const save = (cr) => db.setTaskState(sub, task.id, { status: "building", result: { ...task.result, cartRun: cr } });
  save(cartRun);

  (async () => {
    try {
      const done = await cartBuilder(cartRun, save, controller.signal);
      db.setTaskState(sub, task.id, { status: "built", result: { ...task.result, cartRun: done } });
    } catch (err) {
      log.error(`[task ${task.id}] cart build failed:`, err.message);
      db.setTaskState(sub, task.id, {
        status: previousStatus,
        result: task.result, // keeps the review and any earlier build
        error: err.userMessage ?? "The agent couldn't build your cart. Please try again in a moment.",
      });
    } finally {
      activeBuilds.delete(key);
    }
  })();
  return cartRun;
}
