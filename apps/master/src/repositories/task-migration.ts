import type { CategoryTaskRecord } from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { getTask } from "./tasks.js";

export interface TaskMigrationCandidate {
  taskStatus: string;
  taskStoreId: string;
  checkpointArtifactId?: string;
  slotStatus: string;
  slotStoreId?: string;
  workerStatus: string;
  workerDiskFreeBytes?: number;
  workerClockOffsetMs?: number;
  remoteDesktopStatus?: string;
  accountStatus?: string;
  accountRiskLevel?: string;
  profileStatus?: string;
  endpointStatus?: string;
  activeTaskCount: number;
  workerId?: string;
  accountId?: string;
  profileId?: string;
  endpointId?: string;
}

export function validateTaskMigrationCandidate(candidate: TaskMigrationCandidate): void {
  if (!candidate.checkpointArtifactId) throw new Error("migration_checkpoint_required");
  if (!['manual_required', 'paused', 'pending'].includes(candidate.taskStatus)) throw new Error("migration_source_not_paused");
  if (!candidate.slotStoreId || candidate.slotStoreId !== candidate.taskStoreId) throw new Error("migration_store_mismatch");
  if (!candidate.workerId || !candidate.accountId || !candidate.profileId || !candidate.endpointId) {
    throw new Error("migration_target_binding_incomplete");
  }
  if (candidate.activeTaskCount > 0) throw new Error("migration_target_busy");
  const healthy =
    ['idle', 'ready'].includes(candidate.slotStatus) &&
    candidate.workerStatus === 'online' &&
    (candidate.workerDiskFreeBytes || 0) >= 5 * 1024 ** 3 &&
    candidate.workerClockOffsetMs !== undefined &&
    Math.abs(candidate.workerClockOffsetMs) < 30_000 &&
    candidate.remoteDesktopStatus === 'ready' &&
    ['safe', 'cooldown'].includes(candidate.accountStatus || '') &&
    ['normal', 'watch'].includes(candidate.accountRiskLevel || '') &&
    candidate.profileStatus === 'safe' &&
    ['ready', 'idle'].includes(candidate.endpointStatus || '');
  if (!healthy) throw new Error("migration_target_unhealthy");
}

export async function migrateTaskToBrowserSlot(
  db: Pool,
  taskId: string,
  targetSlotId: string,
  reason?: string
): Promise<CategoryTaskRecord> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT
        t.status AS task_status,
        t.store_id AS task_store_id,
        t.checkpoint_artifact_id,
        bs.status AS slot_status,
        bs.target_store_id AS slot_store_id,
        bs.worker_id,
        bs.account_id,
        bs.profile_id,
        CASE WHEN w.last_seen_at < now() - interval '90 seconds' THEN 'offline' ELSE w.status END AS worker_status,
        w.disk_free_bytes AS worker_disk_free_bytes,
        w.clock_offset_ms AS worker_clock_offset_ms,
        w.remote_desktop->>'status' AS remote_desktop_status,
        a.status AS account_status,
        a.risk_level AS account_risk_level,
        p.status AS profile_status,
        c.endpoint_id,
        c.status AS endpoint_status,
        (
          SELECT COUNT(*)::int FROM category_tasks active
          WHERE active.task_id <> t.task_id
            AND active.status IN ('assigned','running','collecting','captured','uploading','structuring','validating')
            AND (
              active.assigned_worker_id = bs.worker_id OR
              active.assigned_account_id = bs.account_id OR
              active.assigned_profile_id = bs.profile_id OR
              active.assigned_cdp_endpoint_id = c.endpoint_id
            )
        ) AS active_task_count
      FROM category_tasks t
      JOIN browser_slots bs ON bs.slot_id = $2::uuid
      JOIN workers w ON w.worker_id = bs.worker_id
      LEFT JOIN accounts a ON a.account_id = bs.account_id AND a.worker_id = bs.worker_id
      LEFT JOIN profiles p ON p.profile_id = bs.profile_id AND p.worker_id = bs.worker_id
      LEFT JOIN cdp_endpoints c ON c.endpoint_id = 'slot:' || bs.slot_id::text
      WHERE t.task_id = $1::uuid
      FOR UPDATE OF t, bs
    `, [taskId, targetSlotId]);
    const row = result.rows[0];
    if (!row) throw new Error("migration_source_or_slot_not_found");
    const candidate: TaskMigrationCandidate = {
      taskStatus: row.task_status,
      taskStoreId: row.task_store_id,
      checkpointArtifactId: row.checkpoint_artifact_id || undefined,
      slotStatus: row.slot_status,
      slotStoreId: row.slot_store_id || undefined,
      workerStatus: row.worker_status,
      workerDiskFreeBytes: row.worker_disk_free_bytes === null ? undefined : Number(row.worker_disk_free_bytes),
      workerClockOffsetMs: row.worker_clock_offset_ms ?? undefined,
      remoteDesktopStatus: row.remote_desktop_status || undefined,
      accountStatus: row.account_status || undefined,
      accountRiskLevel: row.account_risk_level || undefined,
      profileStatus: row.profile_status || undefined,
      endpointStatus: row.endpoint_status || undefined,
      activeTaskCount: Number(row.active_task_count || 0),
      workerId: row.worker_id || undefined,
      accountId: row.account_id || undefined,
      profileId: row.profile_id || undefined,
      endpointId: row.endpoint_id || undefined
    };
    validateTaskMigrationCandidate(candidate);
    await client.query(`
      UPDATE category_tasks SET
        status = 'pending',
        assigned_worker_id = $2,
        assigned_account_id = $3,
        assigned_profile_id = $4,
        assigned_cdp_endpoint_id = $5,
        lease_owner = NULL,
        lease_until = NULL,
        lease_generation = lease_generation + 1,
        cursor = cursor || jsonb_build_object(
          'migratedAt', now(),
          'migratedToSlotId', $6::text,
          'migrationReason', $7::text
        ),
        last_error = NULL,
        updated_at = now()
      WHERE task_id = $1::uuid
    `, [taskId, candidate.workerId, candidate.accountId, candidate.profileId, candidate.endpointId, targetSlotId, reason || 'operator_migration']);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const task = await getTask(db, taskId);
  if (!task) throw new Error("task_not_found_after_migration");
  return task;
}
