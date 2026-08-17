import assert from "node:assert/strict";
import test from "node:test";
import type { CategoryTaskRecord } from "@retail-orchestrator/shared";
import { buildTaskActionUpdate } from "../src/routes/task-actions.js";

function makeTask(overrides: Partial<CategoryTaskRecord> = {}): CategoryTaskRecord {
  return {
    taskId: "task-1",
    runId: "run-1",
    storeId: "store-1",
    storeName: "Store",
    categoryName: "Beverages",
    categoryOrder: 1,
    status: "paused",
    priority: 10,
    assignedWorkerId: "worker-1",
    assignedAccountId: "account-1",
    assignedProfileId: "profile-1",
    assignedCdpEndpointId: "cdp-1",
    leaseOwner: undefined,
    leaseUntil: undefined,
    lastProgressAt: undefined,
    missingSpuCount: 0,
    checkpointArtifactId: undefined,
    rawArtifactId: undefined,
    summaryArtifactId: undefined,
    expectedItems: 20,
    collectedItems: 5,
    cursor: {
      checkpoint: "p3",
      sleepRequestedAt: "2026-07-08T08:00:00.000Z",
      sleepUntil: "2026-07-08T10:00:00.000Z"
    },
    lastError: "captcha",
    createdAt: "2026-07-08T07:30:00.000Z",
    updatedAt: "2026-07-08T08:10:00.000Z",
    ...overrides
  };
}

test("resume preserves current assignment and clears sleep fields plus lastError", () => {
  const now = new Date("2026-07-08T09:00:00.000Z");
  const update = buildTaskActionUpdate(makeTask(), "resume", now);

  assert.equal(update.status, "pending");
  assert.equal(update.assignedWorkerId, "worker-1");
  assert.equal(update.assignedAccountId, "account-1");
  assert.equal(update.assignedProfileId, "profile-1");
  assert.equal(update.assignedCdpEndpointId, "cdp-1");
  assert.equal(update.lastError, null);
  assert.deepEqual(update.cursor, {
    checkpoint: "p3",
    sleepRequestedAt: null,
    sleepUntil: null,
    wakeRequestedAt: "2026-07-08T09:00:00.000Z",
    lastOperatorAction: "resume",
    operatorActionAt: "2026-07-08T09:00:00.000Z"
  });
});

test("sleep preserves fixed assignment so another account cannot claim the task", () => {
  const now = new Date("2026-07-08T09:00:00.000Z");
  const update = buildTaskActionUpdate(makeTask(), "sleep_2h", now);

  assert.equal(update.status, "paused");
  assert.equal(update.assignedWorkerId, "worker-1");
  assert.equal(update.assignedAccountId, "account-1");
  assert.equal(update.assignedProfileId, "profile-1");
  assert.equal(update.assignedCdpEndpointId, "cdp-1");
  assert.equal(update.lastError, "operator requested sleep until 2026-07-08T11:00:00.000Z");
  assert.deepEqual(update.cursor, {
    checkpoint: "p3",
    sleepRequestedAt: "2026-07-08T09:00:00.000Z",
    sleepUntil: "2026-07-08T11:00:00.000Z",
    wakeRequestedAt: "2026-07-08T11:00:00.000Z",
    fixedAssignmentPreserved: true,
    lastOperatorAction: "sleep_2h",
    operatorActionAt: "2026-07-08T09:00:00.000Z"
  });
});

test("requeue preserves fixed assignment so another eligible claimant cannot pick the task", () => {
  const now = new Date("2026-07-08T09:00:00.000Z");
  const update = buildTaskActionUpdate(makeTask(), "requeue", now);

  assert.equal(update.status, "pending");
  assert.equal(update.assignedWorkerId, "worker-1");
  assert.equal(update.assignedAccountId, "account-1");
  assert.equal(update.assignedProfileId, "profile-1");
  assert.equal(update.assignedCdpEndpointId, "cdp-1");
  assert.equal(update.lastError, null);
  assert.deepEqual(update.cursor, {
    checkpoint: "p3",
    sleepRequestedAt: null,
    sleepUntil: null,
    wakeRequestedAt: "2026-07-08T09:00:00.000Z",
    fixedAssignmentPreserved: true,
    lastOperatorAction: "requeue",
    operatorActionAt: "2026-07-08T09:00:00.000Z"
  });
});

test("mark_manual_required keeps current assignment intact", () => {
  const now = new Date("2026-07-08T09:00:00.000Z");
  const update = buildTaskActionUpdate(makeTask(), "mark_manual_required", now);

  assert.equal(update.status, "manual_required");
  assert.equal(update.assignedWorkerId, "worker-1");
  assert.equal(update.assignedAccountId, "account-1");
  assert.equal(update.assignedProfileId, "profile-1");
  assert.equal(update.assignedCdpEndpointId, "cdp-1");
  assert.deepEqual(update.cursor, {
    checkpoint: "p3",
    sleepRequestedAt: "2026-07-08T08:00:00.000Z",
    sleepUntil: "2026-07-08T10:00:00.000Z",
    lastOperatorAction: "mark_manual_required",
    operatorActionAt: "2026-07-08T09:00:00.000Z"
  });
});
