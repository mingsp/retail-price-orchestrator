import type { RiskEventPayload, RiskEventRecord } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function insertRiskEvent(db: Pool, payload: RiskEventPayload): Promise<RiskEventRecord> {
  const event = payload.event;
  const result = await db.query(
    `
    INSERT INTO risk_events (
      severity, risk_type, worker_id, account_id, profile_id, cdp_port,
      store_id, store_name, category_name, phase, observed, recommended_action
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
    `,
    [
      event.severity,
      event.riskType,
      event.workerId,
      event.accountId || null,
      event.profileId || null,
      event.cdpPort || null,
      event.storeId || null,
      event.storeName || null,
      event.categoryName || null,
      event.phase || null,
      event.observed,
      event.recommendedAction
    ]
  );
  return mapRiskEvent(result.rows[0]);
}

export async function listRiskEvents(db: Pool): Promise<RiskEventRecord[]> {
  const result = await db.query(`
    SELECT *
    FROM risk_events
    ORDER BY created_at DESC
    LIMIT 500
  `);
  return result.rows.map(mapRiskEvent);
}

export async function updateRiskEventStatus(
  db: Pool,
  riskId: string,
  status: RiskEventRecord["status"]
): Promise<RiskEventRecord | null> {
  const result = await db.query(
    `
    UPDATE risk_events SET
      status = $2,
      resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END
    WHERE risk_id = $1
    RETURNING *
    `,
    [riskId, status]
  );
  return result.rows[0] ? mapRiskEvent(result.rows[0]) : null;
}

function mapRiskEvent(row: any): RiskEventRecord {
  return {
    riskId: row.risk_id,
    severity: row.severity,
    riskType: row.risk_type,
    workerId: row.worker_id,
    accountId: row.account_id || undefined,
    profileId: row.profile_id || undefined,
    cdpPort: row.cdp_port || undefined,
    storeId: row.store_id || undefined,
    storeName: row.store_name || undefined,
    categoryName: row.category_name || undefined,
    phase: row.phase || undefined,
    observed: row.observed,
    recommendedAction: row.recommended_action,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString()
  };
}
