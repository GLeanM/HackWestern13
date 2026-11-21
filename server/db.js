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
`;

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

  return {
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
