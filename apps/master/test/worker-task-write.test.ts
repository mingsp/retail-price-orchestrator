import assert from "node:assert/strict";
import test from "node:test";
import type { UpdateCategoryTaskInput } from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { updateTask } from "../src/repositories/tasks.js";
import { validateWorkerTaskUpdate } from "../src/routes/tasks.js";
import { validateArtifactWriteScope } from "../src/repositories/task-write-guard.js";

test("worker task writes always require a matching fenced lease", () => {
  const valid: UpdateCategoryTaskInput = {
    status: "running",
    collectedItems: 20,
    expectedLeaseOwner: "worker-a",
    expectedLeaseGeneration: 3
  };
  assert.doesNotThrow(() => validateWorkerTaskUpdate({ workerId: "worker-a", legacy: false }, valid));
  assert.throws(() => validateWorkerTaskUpdate({ workerId: "worker-a", legacy: false }, { status: "running" }), /task_write_lease_required/);
  assert.throws(() => validateWorkerTaskUpdate({ workerId: "worker-b", legacy: false }, valid), /worker_identity_mismatch/);
});

test("worker task writes cannot reassign task ownership", () => {
  assert.throws(() => validateWorkerTaskUpdate(
    { workerId: "worker-a", legacy: false },
    {
      assignedWorkerId: "worker-b",
      expectedLeaseOwner: "worker-a",
      expectedLeaseGeneration: 3
    }
  ), /worker_task_assignment_forbidden/);
});

test("worker task writes atomically reject an expired lease", async () => {
  const db = {
    async query(sql: string) {
      assert.match(sql, /lease_owner\s*=\s*\$28/);
      assert.match(sql, /lease_generation\s*=\s*\$29/);
      assert.match(sql, /lease_until\s*>\s*now\(\)/);
      return { rows: [] };
    }
  } as unknown as Pool;

  const task = await updateTask(db, "task-1", {
    status: "completed",
    collectedItems: 20,
    expectedLeaseOwner: "worker-a",
    expectedLeaseGeneration: 3
  });

  assert.equal(task, null);
});

test("artifact writes are confined to the task prefix and authoritative identities", () => {
  const authoritative = {
    taskId: "task-a",
    runId: "run-a",
    storeId: "store-a",
    accountId: "account-a",
    profileId: "profile-a"
  };
  const valid = {
    bucket: "raw-artifacts",
    objectKey: "store-a/run-a/task-a/products.raw.jsonl",
    runId: "run-a",
    storeId: "store-a",
    accountId: "account-a",
    profileId: "profile-a"
  };
  assert.doesNotThrow(() => validateArtifactWriteScope(authoritative, valid));
  assert.throws(
    () => validateArtifactWriteScope(authoritative, { ...valid, objectKey: "store-b/run-b/task-b/raw.jsonl" }),
    /artifact_object_key_out_of_scope/
  );
  assert.throws(
    () => validateArtifactWriteScope(authoritative, { ...valid, accountId: "account-b" }),
    /artifact_identity_mismatch/
  );
  assert.throws(
    () => validateArtifactWriteScope(authoritative, { ...valid, bucket: "exports" }),
    /artifact_bucket_not_worker_writable/
  );
  assert.throws(
    () => validateArtifactWriteScope(authoritative, { ...valid, objectKey: "store-a/run-a/task-a/../other" }),
    /artifact_object_key_invalid/
  );
  assert.throws(
    () => validateArtifactWriteScope(authoritative, { ...valid, accountId: undefined }),
    /artifact_identity_mismatch/
  );
});
