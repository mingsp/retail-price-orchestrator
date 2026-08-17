import type {
  BusinessActivityRecord,
  BusinessDeliveryRecord,
  BusinessIssueRecord,
  BusinessOverviewRecord
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";

const technicalKeys = new Set([
  "workerId", "profileId", "cdpPort", "cdpEndpoint", "cdpEndpointId", "endpoint", "objectKey",
  "rawError", "assignedWorkerId", "assignedProfileId", "assignedCdpEndpointId", "accountId"
]);

export function containsTechnicalField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsTechnicalField);
  return Object.entries(value).some(([key, child]) => technicalKeys.has(key) || containsTechnicalField(child));
}

export function toBusinessActivity(row: any): BusinessActivityRecord {
  const status = String(row.status);
  const storeName = row.store_name || "目标门店";
  const categoryName = row.category_name || undefined;
  const collectedItems = Number(row.collected_items || 0);
  return {
    activityId: row.activity_id || `${row.task_id}:${new Date(row.updated_at).toISOString()}`,
    occurredAt: new Date(row.updated_at).toISOString(),
    storeName,
    categoryName,
    message: buildActivityMessage(status, storeName, categoryName, collectedItems),
    tone: activityTone(status)
  };
}

export function toBusinessIssue(row: any): BusinessIssueRecord {
  const storeName = row.store_name || "目标门店";
  return {
    issueId: row.risk_id,
    occurredAt: new Date(row.created_at).toISOString(),
    storeName,
    categoryName: row.category_name || undefined,
    severity: row.severity,
    message: issueMessage(row.risk_type),
    actionLabel: "去处理"
  };
}

export async function getBusinessOverview(db: Pool, businessDate: string): Promise<BusinessOverviewRecord> {
  const result = await db.query(
    `
    WITH day_runs AS (
      SELECT run_id, status
      FROM store_runs
      WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND created_at < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')
    )
    SELECT
      (SELECT count(*) FROM day_runs)::int AS target_runs,
      (SELECT count(*) FROM day_runs WHERE status IN ('running', 'paused'))::int AS active_runs,
      (SELECT count(*) FROM day_runs WHERE status = 'completed')::int AS completed_runs,
      (SELECT count(*) FROM risk_events WHERE status <> 'resolved')::int AS open_issues,
      (SELECT count(DISTINCT p.store_run_id::text || '|' || p.store_id || '|' || p.spu_id)
       FROM product_snapshots p JOIN day_runs d ON d.run_id = p.store_run_id)::int AS collected_products,
      (SELECT count(*) FROM accounts a JOIN profiles p ON p.profile_id = a.profile_id
       WHERE a.status IN ('safe', 'running') AND a.risk_level NOT IN ('high', 'blocked') AND p.status = 'safe')::int
       AS available_collection_slots
    `,
    [businessDate]
  );
  const row = result.rows[0];
  return {
    businessDate,
    targetRuns: row.target_runs,
    activeRuns: row.active_runs,
    completedRuns: row.completed_runs,
    openIssues: row.open_issues,
    collectedProducts: row.collected_products,
    availableCollectionSlots: row.available_collection_slots
  };
}

export async function listBusinessActivities(
  db: Pool,
  options: { before?: string; limit?: number } = {}
): Promise<BusinessActivityRecord[]> {
  const limit = boundedLimit(options.limit);
  const result = await db.query(
    `
    SELECT e.activity_id, e.task_id, s.name AS store_name, e.category_name, e.status, e.collected_items,
      e.occurred_at AS updated_at
    FROM business_activity_events e JOIN stores s ON s.store_id = e.store_id
    WHERE ($1::timestamptz IS NULL OR e.occurred_at < $1::timestamptz)
    ORDER BY e.occurred_at DESC, e.activity_id DESC
    LIMIT $2
    `,
    [options.before || null, limit]
  );
  return result.rows.map(toBusinessActivity);
}

export async function listBusinessIssues(
  db: Pool,
  options: { before?: string; limit?: number } = {}
): Promise<BusinessIssueRecord[]> {
  const result = await db.query(
    `
    SELECT risk_id, store_name, category_name, risk_type, severity, created_at
    FROM risk_events
    WHERE status <> 'resolved'
      AND ($1::timestamptz IS NULL OR created_at < $1::timestamptz)
    ORDER BY created_at DESC, risk_id DESC
    LIMIT $2
    `,
    [options.before || null, boundedLimit(options.limit)]
  );
  return result.rows.map(toBusinessIssue);
}

export async function listBusinessDeliveries(db: Pool): Promise<BusinessDeliveryRecord[]> {
  const result = await db.query(`
    WITH product_counts AS (
      SELECT store_run_id AS run_id, count(DISTINCT spu_id)::int AS product_count
      FROM product_snapshots
      WHERE store_run_id IS NOT NULL
      GROUP BY store_run_id
    ), artifact_flags AS (
      SELECT run_id, bool_or(kind = 'raw_jsonl') AS has_raw_data
      FROM artifacts
      WHERE run_id IS NOT NULL
      GROUP BY run_id
    ), task_counts AS (
      SELECT run_id,
        count(*) FILTER (WHERE status = 'completed_valid')::int AS completed_tasks,
        count(*)::int AS total_tasks,
        count(*) FILTER (WHERE status IN ('manual_required', 'needs_review', 'failed'))::int AS attention_tasks
      FROM category_tasks
      GROUP BY run_id
    )
    SELECT r.run_id, s.name AS store_name, r.run_label, r.status, r.updated_at,
      COALESCE(p.product_count, 0) AS product_count,
      COALESCE(a.has_raw_data, false) AS has_raw_data,
      COALESCE(t.completed_tasks, 0) AS completed_tasks,
      COALESCE(t.total_tasks, 0) AS total_tasks,
      COALESCE(t.attention_tasks, 0) AS attention_tasks,
      d.status AS delivery_status, d.export_artifact_id
    FROM store_runs r
    JOIN stores s ON s.store_id = r.store_id
    LEFT JOIN product_counts p ON p.run_id = r.run_id
    LEFT JOIN artifact_flags a ON a.run_id = r.run_id
    LEFT JOIN task_counts t ON t.run_id = r.run_id
    LEFT JOIN data_deliveries d ON d.run_id = r.run_id
    WHERE r.status <> 'cancelled'
    ORDER BY r.updated_at DESC
    LIMIT 200
  `);
  return result.rows.map((row) => {
    const runReady = row.total_tasks > 0 && row.completed_tasks === row.total_tasks && Boolean(row.has_raw_data);
    const ready = Boolean(row.export_artifact_id) && ["ready", "synced"].includes(row.delivery_status);
    return {
      runId: row.run_id,
      storeName: row.store_name,
      runLabel: row.run_label,
      status: ready ? "ready" : row.attention_tasks > 0 || row.delivery_status === "failed" ? "attention" : runReady ? "checking" : "collecting",
      productCount: row.product_count,
      hasRawData: Boolean(row.has_raw_data),
      canExport: ready,
      canPrepare: runReady && !ready,
      updatedAt: row.updated_at.toISOString()
    } satisfies BusinessDeliveryRecord;
  });
}

function buildActivityMessage(status: string, storeName: string, categoryName: string | undefined, count: number): string {
  const target = `${storeName}${categoryName ? ` · ${categoryName}` : ""}`;
  if (status === "completed_valid") return `${target} 已完成校验，共采集 ${count} 条商品数据。`;
  if (["manual_required", "needs_review", "failed"].includes(status)) return `${target} 暂停更新，采集断点已保留。`;
  if (["captured", "uploading", "structuring", "validating"].includes(status)) return `${target} 已采回 ${count} 条，正在核对完整性。`;
  if (["assigned", "running", "collecting"].includes(status)) return `${target} 正在采集，当前已获得 ${count} 条商品数据。`;
  return `${target} 等待开始采集。`;
}

function activityTone(status: string): BusinessActivityRecord["tone"] {
  if (status === "completed_valid") return "success";
  if (["manual_required", "needs_review", "failed"].includes(status)) return "danger";
  if (["paused", "captured", "uploading", "structuring", "validating"].includes(status)) return "warning";
  return "neutral";
}

function issueMessage(riskType: string): string {
  if (["captcha", "identity_check", "login_required"].includes(riskType)) {
    return "该门店当前需要人工确认，已保留采集断点。";
  }
  if (["interface_403", "interface_418", "account_blocked", "profile_risk", "device_risk"].includes(riskType)) {
    return "该渠道数据暂时无法更新，系统已停止当前入口并保留已采数据。";
  }
  return "该类目暂时无法继续更新，已保留采集断点。";
}

function boundedLimit(limit = 50): number {
  return Math.min(Math.max(Number.isFinite(limit) ? Math.floor(limit) : 50, 1), 100);
}
