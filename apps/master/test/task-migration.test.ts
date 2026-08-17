import assert from "node:assert/strict";
import test from "node:test";
import { validateTaskMigrationCandidate } from "../src/repositories/task-migration.js";

const healthy = {
  taskStatus: "manual_required",
  taskStoreId: "store-a",
  checkpointArtifactId: "artifact-a",
  slotStatus: "idle",
  slotStoreId: "store-a",
  workerStatus: "online",
  workerDiskFreeBytes: 10 * 1024 ** 3,
  workerClockOffsetMs: 0,
  remoteDesktopStatus: "ready",
  accountStatus: "safe",
  accountRiskLevel: "normal",
  profileStatus: "safe",
  endpointStatus: "ready",
  activeTaskCount: 0,
  workerId: "worker-b",
  accountId: "account-b",
  profileId: "profile-b",
  endpointId: "slot:slot-b"
};

test("cross-worker migration requires a checkpoint and a fully healthy target slot", () => {
  assert.doesNotThrow(() => validateTaskMigrationCandidate(healthy));
  assert.throws(() => validateTaskMigrationCandidate({ ...healthy, checkpointArtifactId: undefined }), /checkpoint_required/);
  assert.throws(() => validateTaskMigrationCandidate({ ...healthy, slotStoreId: "store-b" }), /migration_store_mismatch/);
  assert.throws(() => validateTaskMigrationCandidate({ ...healthy, activeTaskCount: 1 }), /migration_target_busy/);
  assert.throws(() => validateTaskMigrationCandidate({ ...healthy, profileStatus: "profile_risk" }), /migration_target_unhealthy/);
});
