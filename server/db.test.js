import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";

test("a restart mid-task never leaves work stuck, and keeps the plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "cartpilot-db-"));
  try {
    const path = join(dir, "t.db");
    let db = openDb(path);
    const plan = { toBuy: [{ name: "eggs" }] };
    db.createTask("u", "a0000000-0000-4000-8000-000000000001", {});
    db.createTask("u", "a0000000-0000-4000-8000-000000000002", {});
    db.createTask("u", "a0000000-0000-4000-8000-000000000003", {});
    db.setTaskState("u", "a0000000-0000-4000-8000-000000000002", { status: "researching", result: plan });
    db.setTaskState("u", "a0000000-0000-4000-8000-000000000003", { status: "building", result: plan });
    db.close();

    db = openDb(path);
    const [planning, researching, building] = ["1", "2", "3"].map((n) => db.getTask("u", `a0000000-0000-4000-8000-00000000000${n}`));
    assert.equal(planning.status, "failed");
    assert.equal(researching.status, "planned");
    assert.deepEqual(researching.result, plan);
    assert.equal(building.status, "priced");
    assert.match(building.error, /Check your T&T cart/);
    assert.deepEqual(building.result, plan);
    assert.equal(db.activeTaskCount("u"), 0);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claimBuild only moves priced or built tasks, once", () => {
  const db = openDb(":memory:");
  const id = "b0000000-0000-4000-8000-000000000001";
  db.createTask("u", id, {});
  db.setTaskState("u", id, { status: "planned", result: {} });
  assert.equal(db.claimBuild("u", id), false);
  db.setTaskState("u", id, { status: "priced", result: {} });
  assert.equal(db.claimBuild("other-user", id), false);
  assert.equal(db.claimBuild("u", id), true);
  assert.equal(db.claimBuild("u", id), false); // already building
  assert.equal(db.activeTaskCount("u"), 1);
  db.close();
});
