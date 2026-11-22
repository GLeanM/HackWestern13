import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// One row per Auth0 user. Every query is keyed by `sub` taken from a verified
// access token — never by an id supplied in the request body or URL.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    sub        TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS user_preferences (
    sub        TEXT PRIMARY KEY REFERENCES users(sub) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS shopping_tasks (
    id         TEXT PRIMARY KEY,
    sub        TEXT NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    input      TEXT NOT NULL,
    result     TEXT,
    error      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS shopping_tasks_sub ON shopping_tasks (sub, created_at DESC);
`;

function taskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    input: JSON.parse(row.input),
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const insertUser = db.prepare("INSERT OR IGNORE INTO users (sub) VALUES (?)");
  const selectPrefs = db.prepare(
    "SELECT data, updated_at FROM user_preferences WHERE sub = ?",
  );
  const upsertPrefs = db.prepare(`
    INSERT INTO user_preferences (sub, data, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(sub) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `);

  const insertTask = db.prepare(
    "INSERT INTO shopping_tasks (id, sub, status, input) VALUES (?, ?, ?, ?)",
  );
  // Ownership is part of every task query: a task id alone is never enough.
  const selectTask = db.prepare("SELECT * FROM shopping_tasks WHERE id = ? AND sub = ?");
  const selectTasks = db.prepare(
    "SELECT * FROM shopping_tasks WHERE sub = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
  );
  const countActive = db.prepare(
    "SELECT COUNT(*) AS n FROM shopping_tasks WHERE sub = ? AND status IN ('planning', 'researching')",
  );
  const finishTask = db.prepare(
    "UPDATE shopping_tasks SET status = ?, result = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND sub = ?",
  );
  const setState = db.prepare(
    "UPDATE shopping_tasks SET status = ?, result = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND sub = ?",
  );
  // Atomic "planned/priced → researching" so two clicks can't start two searches.
  const claimResearch = db.prepare(
    "UPDATE shopping_tasks SET status = 'researching', error = NULL, updated_at = datetime('now') WHERE id = ? AND sub = ? AND status IN ('planned', 'priced')",
  );
  // Tasks interrupted by a server restart can never finish. A plan that was
  // mid-planning fails; one that was mid-pricing keeps its plan.
  db.prepare(
    "UPDATE shopping_tasks SET status = 'failed', error = 'Interrupted by a server restart. Please try again.' WHERE status = 'planning'",
  ).run();
  db.prepare(
    "UPDATE shopping_tasks SET status = 'planned', error = 'Price search was interrupted. Please try again.' WHERE status = 'researching'",
  ).run();

  return {
    createTask(sub, id, input) {
      insertUser.run(sub);
      insertTask.run(id, sub, "planning", JSON.stringify(input));
      return taskRow(selectTask.get(id, sub));
    },
    getTask(sub, id) {
      return taskRow(selectTask.get(id, sub));
    },
    listTasks(sub, limit = 10) {
      return selectTasks.all(sub, limit).map(taskRow);
    },
    activeTaskCount(sub) {
      return countActive.get(sub).n;
    },
    completeTask(sub, id, result) {
      finishTask.run("planned", JSON.stringify(result), null, id, sub);
    },
    failTask(sub, id, message) {
      finishTask.run("failed", null, message, id, sub);
    },
    /** Returns true if the task moved to "researching" (it was planned or priced). */
    claimResearch(sub, id) {
      return claimResearch.run(id, sub).changes === 1;
    },
    setTaskState(sub, id, { status, result, error = null }) {
      setState.run(status, result === undefined ? null : JSON.stringify(result), error, id, sub);
    },
    getProfile(sub) {
      const row = selectPrefs.get(sub);
      return row ? { ...JSON.parse(row.data), updatedAt: row.updated_at } : null;
    },
    saveProfile(sub, profile) {
      insertUser.run(sub);
      upsertPrefs.run(sub, JSON.stringify(profile));
      return this.getProfile(sub);
    },
    close() {
      db.close();
    },
  };
}
