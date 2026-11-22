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
  -- What the cart agent saw at a store, by postal area (FSA). Store facts only.
  CREATE TABLE IF NOT EXISTS store_stock (
    fsa         TEXT NOT NULL,
    url         TEXT NOT NULL,
    misses      INTEGER NOT NULL DEFAULT 0,
    out_of_stock INTEGER NOT NULL DEFAULT 0,
    available   INTEGER NOT NULL DEFAULT 0,
    seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (fsa, url)
  );
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
    "SELECT COUNT(*) AS n FROM shopping_tasks WHERE sub = ? AND status IN ('planning', 'researching', 'building')",
  );
  const finishTask = db.prepare(
    "UPDATE shopping_tasks SET status = ?, result = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND sub = ?",
  );
  const setState = db.prepare(
    "UPDATE shopping_tasks SET status = ?, result = ?, error = ?, updated_at = datetime('now') WHERE id = ? AND sub = ?",
  );
  // Atomic "planned/priced → researching" so two clicks can't start two searches.
  const claimResearch = db.prepare(
    "UPDATE shopping_tasks SET status = 'researching', error = NULL, updated_at = datetime('now') WHERE id = ? AND sub = ? AND status IN ('planned', 'priced', 'built')",
  );
  // Tasks interrupted by a server restart can never finish. A plan that was
  // mid-planning fails; one that was mid-pricing keeps its plan.
  db.prepare(
    "UPDATE shopping_tasks SET status = 'failed', error = 'Interrupted by a server restart. Please try again.' WHERE status = 'planning'",
  ).run();
  db.prepare(
    "UPDATE shopping_tasks SET status = 'planned', error = 'Price search was interrupted. Please try again.' WHERE status = 'researching'",
  ).run();
  // TinyFish runs of builds cut off by a restart keep running (and costing
  // money) unless cancelled; index.js cancels these on startup.
  const interruptedRunIds = db
    .prepare("SELECT result FROM shopping_tasks WHERE status = 'building'")
    .all()
    .flatMap((row) => {
      try {
        return (JSON.parse(row.result)?.cartRun?.runs ?? []).map((r) => r.runId).filter(Boolean);
      } catch {
        return [];
      }
    });
  // Some items may already be in the T&T cart, so say so rather than failing silently.
  db.prepare(
    "UPDATE shopping_tasks SET status = 'priced', error = 'The cart build was interrupted. Check your T&T cart before trying again.' WHERE status = 'building'",
  ).run();
  // Atomic "priced/built → building" so a double click can't start two agents.
  const claimBuild = db.prepare(
    "UPDATE shopping_tasks SET status = 'building', error = NULL, updated_at = datetime('now') WHERE id = ? AND sub = ? AND status IN ('priced', 'built')",
  );

  const upsertStock = db.prepare(`
    INSERT INTO store_stock (fsa, url, misses, out_of_stock, available, seen_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(fsa, url) DO UPDATE SET
      misses = CASE WHEN excluded.available = 1 THEN 0 ELSE misses + excluded.misses END,
      out_of_stock = CASE WHEN excluded.available = 1 THEN 0 ELSE excluded.out_of_stock END,
      available = excluded.available,
      seen_at = excluded.seen_at
  `);
  const selectStock = db.prepare(
    "SELECT url, misses, out_of_stock, available FROM store_stock WHERE fsa = ? AND seen_at >= datetime('now', ?)",
  );

  return {
    interruptedRunIds,
    /** Record what the cart agent saw: [{ url, seen: "available"|"out_of_stock"|"not_found" }]. */
    recordStoreStock(fsa, observations) {
      if (!fsa) return;
      for (const o of observations) {
        upsertStock.run(fsa, o.url, o.seen === "not_found" ? 1 : 0, o.seen === "out_of_stock" ? 1 : 0, o.seen === "available" ? 1 : 0);
      }
    },
    /**
     * Known stock at a store: Map<url, "available"|"unavailable">. A product
     * counts as unavailable if it was out of stock last time, or the agent
     * couldn't find it twice in a row (one miss can be the agent's mistake).
     */
    storeStock(fsa, ttlDays = 14) {
      const known = new Map();
      if (!fsa) return known;
      for (const r of selectStock.all(fsa, `-${ttlDays} days`)) {
        if (r.available) known.set(r.url, "available");
        else if (r.out_of_stock || r.misses >= 2) known.set(r.url, "unavailable");
      }
      return known;
    },
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
    /** Returns true if the task moved to "building" (it was priced or built). */
    claimBuild(sub, id) {
      return claimBuild.run(id, sub).changes === 1;
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
