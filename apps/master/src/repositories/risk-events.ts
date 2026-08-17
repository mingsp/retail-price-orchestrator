import type { RiskClusterRecord, RiskEventPayload, RiskEventRecord } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function insertRiskEvent(db: Pool, payload: RiskEventPayload): Promise<RiskEventRecord> {
  const event = payload.event;
  const result = await db.query(
    `
    INSERT INTO risk_events (
      risk_id, severity, risk_type, worker_id, account_id, profile_id, cdp_port,
      store_id, store_name, category_name, phase, screenshot_artifact_id, observed, recommended_action
    )
    VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT (risk_id) DO UPDATE SET risk_id = EXCLUDED.risk_id
    RETURNING *
    `,
    [
      event.riskId || null,
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
      event.screenshotArtifactId || null,
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

export async function listRiskClusters(db: Pool): Promise<RiskClusterRecord[]> {
  const risks = await listRiskEvents(db);
  return buildRiskClusters(risks);
}

export function buildRiskClusters(risks: RiskEventRecord[]): RiskClusterRecord[] {
  const groups = new Map<string, RiskEventRecord[]>();
  for (const risk of risks) {
    const key = [risk.storeId || "unknown_store", risk.categoryName || "unknown_category", risk.riskType].join("|");
    const current = groups.get(key) || [];
    current.push(risk);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const open = group.filter((risk) => risk.status !== "resolved");
      const accounts = unique(group.map((risk) => risk.accountId).filter(Boolean) as string[]);
      const profiles = unique(group.map((risk) => risk.profileId).filter(Boolean) as string[]);
      const workers = unique(group.map((risk) => risk.workerId).filter(Boolean));
      const sorted = [...group].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      const mostSevere = sortBySeverity(group)[0];
      const status = resolveClusterStatus(open.length, accounts.length, mostSevere?.severity || "low");
      return {
        clusterId: key,
        severity: mostSevere?.severity || "low",
        riskType: group[0].riskType,
        storeId: group[0].storeId,
        storeName: group.find((risk) => risk.storeName)?.storeName,
        categoryName: group[0].categoryName,
        eventCount: group.length,
        openEventCount: open.length,
        affectedAccountCount: accounts.length,
        affectedAccounts: accounts,
        affectedProfiles: profiles,
        affectedWorkers: workers,
        firstSeenAt: sorted[0].createdAt,
        lastSeenAt: sorted[sorted.length - 1].createdAt,
        status,
        recommendation: buildClusterRecommendation(status, group[0]),
        riskIds: group.map((risk) => risk.riskId)
      } satisfies RiskClusterRecord;
    })
    .sort((left, right) => {
      const statusWeight = { quarantine: 0, watch: 1, resolved: 2 };
      const statusDelta = statusWeight[left.status] - statusWeight[right.status];
      if (statusDelta !== 0) return statusDelta;
      const severityDelta = severityRank(left.severity) - severityRank(right.severity);
      if (severityDelta !== 0) return severityDelta;
      return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    });
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
    screenshotArtifactId: row.screenshot_artifact_id || undefined,
    observed: row.observed,
    recommendedAction: row.recommended_action,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString()
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sortBySeverity(risks: RiskEventRecord[]): RiskEventRecord[] {
  return [...risks].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
}

function severityRank(severity: RiskEventRecord["severity"]): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[severity] ?? 9;
}

function resolveClusterStatus(
  openEventCount: number,
  affectedAccountCount: number,
  severity: RiskEventRecord["severity"]
): RiskClusterRecord["status"] {
  if (openEventCount <= 0) return "resolved";
  if (affectedAccountCount >= 2 && (severity === "critical" || severity === "high")) return "quarantine";
  return "watch";
}

function buildClusterRecommendation(status: RiskClusterRecord["status"], risk: RiskEventRecord): string {
  if (status === "quarantine") {
    return `同一门店/类目已影响多个账号，建议暂停该类目入口，不再继续换号重试；先采集其它类目，人工确认 ${risk.categoryName || "该类目"} 页面状态后再恢复。`;
  }
  if (status === "watch") {
    return "单点风险，建议保留断点并观察同门店其它账号/类目是否复现。";
  }
  return "风险事件已解决，保留记录用于复盘。";
}
