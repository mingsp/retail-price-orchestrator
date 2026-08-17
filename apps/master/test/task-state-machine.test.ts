import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionTask, validTaskPredecessors } from "../src/repositories/task-state-machine.js";

test("collection pipeline only advances through business-safe states", () => {
  assert.equal(canTransitionTask("collecting", "captured"), true);
  assert.equal(canTransitionTask("captured", "uploading"), true);
  assert.equal(canTransitionTask("uploading", "structuring"), true);
  assert.equal(canTransitionTask("structuring", "validating"), true);
});

test("worker cannot jump directly from collecting to completed_valid", () => {
  assert.equal(canTransitionTask("collecting", "completed_valid"), false);
  assert.equal(canTransitionTask("validating", "completed_valid"), true);
});

test("manual intervention and recovery remain available", () => {
  assert.equal(canTransitionTask("collecting", "manual_required"), true);
  assert.equal(canTransitionTask("manual_required", "pending"), true);
  assert.equal(canTransitionTask("failed", "pending"), true);
  assert.equal(canTransitionTask("completed_valid", "pending"), false);
});

test("database predecessor list includes idempotent same-state updates", () => {
  assert.deepEqual(validTaskPredecessors("uploading").sort(), ["captured", "needs_review", "uploading"].sort());
});
