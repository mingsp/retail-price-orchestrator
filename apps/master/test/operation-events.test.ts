import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOperationEventInput } from "../src/repositories/operation-events.js";

test("normalizeOperationEventInput fills actor and detail defaults", () => {
  const input = normalizeOperationEventInput(
    {
      action: " task.resume ",
      targetType: " task ",
      targetId: "task-1",
      taskId: "task-1",
      accountId: "account-1"
    },
    { actor: "operator-a" }
  );

  assert.equal(input.actor, "operator-a");
  assert.equal(input.action, "task.resume");
  assert.equal(input.targetType, "task");
  assert.equal(input.targetId, "task-1");
  assert.equal(input.taskId, "task-1");
  assert.equal(input.accountId, "account-1");
  assert.deepEqual(input.detail, {});
});

test("normalizeOperationEventInput preserves explicit actor and detail", () => {
  const input = normalizeOperationEventInput(
    {
      actor: "worker-mm",
      action: "risk.resolved",
      targetType: "risk",
      riskId: "00000000-0000-0000-0000-000000000001",
      detail: { source: "dashboard" }
    },
    { actor: "operator-a" }
  );

  assert.equal(input.actor, "worker-mm");
  assert.deepEqual(input.detail, { source: "dashboard" });
});
