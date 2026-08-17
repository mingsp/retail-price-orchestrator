import type { Pool, PoolClient } from "pg";

export interface TaskWriteLease {
  taskId?: string;
  workerId?: string;
  leaseOwner?: string;
  leaseGeneration?: number;
}

export interface ArtifactWriteScope extends TaskWriteLease {
  bucket: string;
  objectKey: string;
  runId?: string;
  storeId?: string;
  accountId?: string;
  profileId?: string;
}

export async function assertActiveTaskWriteLease(db: Pool | PoolClient, lease: TaskWriteLease): Promise<void> {
  if (!lease.taskId || !lease.workerId || !lease.leaseOwner || lease.leaseGeneration === undefined) {
    throw new Error("task_write_lease_required");
  }
  const result = await db.query(`
    SELECT task_id FROM category_tasks
    WHERE task_id = $1::uuid
      AND assigned_worker_id = $2
      AND lease_owner = $3
      AND lease_generation = $4
      AND lease_until > now()
      AND status IN ('assigned','running','collecting','captured','uploading','structuring','validating')
  `, [lease.taskId, lease.workerId, lease.leaseOwner, lease.leaseGeneration]);
  if (!result.rows[0]) throw new Error("stale_task_write_lease");
}

export async function assertActiveTaskArtifactWriteScope(
  db: Pool | PoolClient,
  input: ArtifactWriteScope
): Promise<void> {
  if (!input.taskId || !input.workerId || !input.leaseOwner || input.leaseGeneration === undefined) {
    throw new Error("task_write_lease_required");
  }
  const result = await db.query(`
    SELECT task_id, run_id, store_id, assigned_account_id, assigned_profile_id
    FROM category_tasks
    WHERE task_id = $1::uuid
      AND assigned_worker_id = $2
      AND lease_owner = $3
      AND lease_generation = $4
      AND lease_until > now()
      AND status IN ('assigned','running','collecting','captured','uploading','structuring','validating')
  `, [input.taskId, input.workerId, input.leaseOwner, input.leaseGeneration]);
  if (!result.rows[0]) throw new Error("stale_task_write_lease");
  validateArtifactWriteScope({
    taskId: result.rows[0].task_id,
    runId: result.rows[0].run_id,
    storeId: result.rows[0].store_id,
    accountId: result.rows[0].assigned_account_id,
    profileId: result.rows[0].assigned_profile_id
  }, input);
}

export function validateArtifactWriteScope(
  authoritative: { taskId: string; runId: string; storeId: string; accountId?: string | null; profileId?: string | null },
  input: Pick<ArtifactWriteScope, "bucket" | "objectKey" | "runId" | "storeId" | "accountId" | "profileId">
): void {
  if (!["raw-artifacts", "screenshots", "logs"].includes(input.bucket)) {
    throw new Error("artifact_bucket_not_worker_writable");
  }
  if (!input.objectKey || input.objectKey.length > 1024 || input.objectKey.includes("\\")
    || input.objectKey.startsWith("/") || input.objectKey.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("artifact_object_key_invalid");
  }
  const prefix = `${authoritative.storeId}/${authoritative.runId}/${authoritative.taskId}/`;
  if (!input.objectKey.startsWith(prefix) || input.objectKey.length === prefix.length) {
    throw new Error("artifact_object_key_out_of_scope");
  }
  if (!authoritative.accountId || !authoritative.profileId) throw new Error("artifact_task_identity_incomplete");
  if (input.runId !== authoritative.runId || input.storeId !== authoritative.storeId
    || input.accountId !== authoritative.accountId || input.profileId !== authoritative.profileId) {
    throw new Error("artifact_identity_mismatch");
  }
}
