import type { RiskEventPayload } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function insertRiskEvent(db: Pool, payload: RiskEventPayload): Promise<void> {
  const event = payload.event;
  await db.query(
    `
    INSERT INTO risk_events (
      severity, risk_type, worker_id, account_id, profile_id, cdp_port,
      store_id, store_name, category_name, phase, observed, recommended_action
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
}

