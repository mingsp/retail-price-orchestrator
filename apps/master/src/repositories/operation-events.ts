import type { OperationEventInput, OperationEventRecord } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export interface OperationEventFilters {
  taskId?: string;
  accountId?: string;
  profileId?: string;
  cdpEndpointId?: string;
  riskId?: string;
  limit?: number;
}

export function normalizeOperationEventInput(
  input: OperationEventInput,
  defaults: { actor?: string } = {}
): Required<Pick<OperationEventInput, "actor" | "action" | "targetType" | "detail">> & OperationEventInput {
  return {
    ...input,
    actor: input.actor || defaults.actor || "dashboard",
    action: input.action.trim(),
    targetType: input.targetType.trim(),
    detail: input.detail || {}
  };
}

export async function insertOperationEvent(
  db: Pool,
  rawInput: OperationEventInput,
  defaults: { actor?: string } = {}
): Promise<OperationEventRecord> {
  const input = normalizeOperationEventInput(rawInput, defaults);
  const result = await db.query(
    `
    INSERT INTO operation_events (
      actor, action, target_type, target_id, worker_id, account_id, profile_id,
      cdp_endpoint_id, store_id, task_id, risk_id, detail
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
    `,
    [
      input.actor,
      input.action,
      input.targetType,
      input.targetId || null,
      input.workerId || null,
      input.accountId || null,
      input.profileId || null,
      input.cdpEndpointId || null,
      input.storeId || null,
      input.taskId || null,
      input.riskId || null,
      JSON.stringify(input.detail)
    ]
  );
  return mapOperationEvent(result.rows[0]);
}

export async function listOperationEvents(
  db: Pool,
  filters: OperationEventFilters = {}
): Promise<OperationEventRecord[]> {
  const limit = Math.min(Math.max(filters.limit || 200, 1), 500);
  const result = await db.query(
    `
    SELECT *
    FROM operation_events
    WHERE ($1::uuid IS NULL OR task_id = $1::uuid)
      AND ($2::text IS NULL OR account_id = $2)
      AND ($3::text IS NULL OR profile_id = $3)
      AND ($4::text IS NULL OR cdp_endpoint_id = $4)
      AND ($5::uuid IS NULL OR risk_id = $5::uuid)
    ORDER BY created_at DESC
    LIMIT $6
    `,
    [
      filters.taskId || null,
      filters.accountId || null,
      filters.profileId || null,
      filters.cdpEndpointId || null,
      filters.riskId || null,
      limit
    ]
  );
  return result.rows.map(mapOperationEvent);
}

function mapOperationEvent(row: any): OperationEventRecord {
  return {
    eventId: row.event_id,
    actor: row.actor,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id || undefined,
    workerId: row.worker_id || undefined,
    accountId: row.account_id || undefined,
    profileId: row.profile_id || undefined,
    cdpEndpointId: row.cdp_endpoint_id || undefined,
    storeId: row.store_id || undefined,
    taskId: row.task_id || undefined,
    riskId: row.risk_id || undefined,
    detail: row.detail || {},
    createdAt: row.created_at.toISOString()
  };
}
