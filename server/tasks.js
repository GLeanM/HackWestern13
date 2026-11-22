import { randomUUID } from "node:crypto";
import { consolidate } from "./planner/consolidate.js";

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
  const previousStatus = task.status; // "planned" or "priced"
  db.setTaskState(sub, task.id, { status: "researching", result: plan });

  (async () => {
    try {
      const research = await researcher(plan.toBuy, profile);
      db.setTaskState(sub, task.id, { status: "priced", result: { ...plan, research } });
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
