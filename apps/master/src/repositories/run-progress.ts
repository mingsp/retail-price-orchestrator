import type { RunProgressRecord, RunStatus, TaskStatus } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export interface RunProgressTaskInput {
  status: TaskStatus;
  collectedItems: number;
  expectedItems?: number;
  qualityStatus?: "pass" | "warn" | "fail";
  exclusionEvidence?: boolean;
}

export interface CalculatedRunProgress {
  status: RunStatus;
  totalCategories: number;
  completedCategories: number;
  activeCategories: number;
  attentionCategories: number;
  categoryCompletionPercent: number;
  expectedItemsKnown: boolean;
  expectedItems?: number;
  collectedItems: number;
  itemProgressPercent?: number;
  validatedCategories: number;
  excludedCategories: number;
  isDeliverable: boolean;
}

const activeStatuses = new Set<TaskStatus>([
  "assigned", "running", "collecting", "captured", "uploading", "structuring", "validating"
]);
const attentionStatuses = new Set<TaskStatus>(["manual_required", "needs_review", "failed"]);

export function calculateRunProgress(tasks: RunProgressTaskInput[]): CalculatedRunProgress {
  const totalCategories = tasks.length;
  const excludedCategories = tasks.filter(
    (task) => task.status === "skipped" && task.exclusionEvidence === true
  ).length;
  const completedCategories = tasks.filter((task) => task.status === "completed_valid").length + excludedCategories;
  const activeCategories = tasks.filter((task) => activeStatuses.has(task.status)).length;
  const attentionCategories = tasks.filter((task) => attentionStatuses.has(task.status)).length;
  const productTasks = tasks.filter((task) => !(task.status === "skipped" && task.exclusionEvidence === true));
  const expectedItemsKnown = productTasks.length > 0 && productTasks.every(
    (task) => typeof task.expectedItems === "number" && task.expectedItems > 0
  );
  const expectedItems = expectedItemsKnown
    ? productTasks.reduce((sum, task) => sum + (task.expectedItems || 0), 0)
    : undefined;
  const collectedItems = tasks.reduce((sum, task) => sum + Math.max(0, task.collectedItems || 0), 0);
  const itemProgressPercent = expectedItemsKnown && expectedItems && expectedItems > 0
    ? Math.min(99, Math.floor((collectedItems / expectedItems) * 100))
    : undefined;
  const validatedCategories = tasks.filter(
    (task) => task.status === "completed_valid" && task.qualityStatus && task.qualityStatus !== "fail"
  ).length;
  const isDeliverable = totalCategories > 0
    && completedCategories === totalCategories
    && validatedCategories + excludedCategories === totalCategories;

  return {
    status: resolveRunStatus(tasks, isDeliverable),
    totalCategories,
    completedCategories,
    activeCategories,
    attentionCategories,
    categoryCompletionPercent: totalCategories ? Math.floor((completedCategories / totalCategories) * 100) : 0,
    expectedItemsKnown,
    expectedItems,
    collectedItems,
    itemProgressPercent: isDeliverable && expectedItemsKnown && expectedItems ? 100 : itemProgressPercent,
    validatedCategories,
    excludedCategories,
    isDeliverable
  };
}

export function applyScopeGate(
  progress: CalculatedRunProgress,
  scopeFrozen: boolean,
  scopeMatches: boolean
): CalculatedRunProgress {
  if (scopeFrozen && scopeMatches) return progress;
  return {
    ...progress,
    status: progress.status === "planned" ? "planned" : "running",
    attentionCategories: progress.attentionCategories + (scopeMatches ? 0 : 1),
    isDeliverable: false
  };
}

export async function getRunProgress(db: Pool, runId: string): Promise<RunProgressRecord | null> {
  const runResult = await db.query(
    `SELECT r.*, s.name AS store_name FROM store_runs r JOIN stores s ON s.store_id = r.store_id WHERE r.run_id = $1`,
    [runId]
  );
  if (!runResult.rows[0]) return null;
  const taskResult = await db.query(
    `
    SELECT t.status, t.canonical_category_key, t.collected_items, t.expected_items, t.cursor, q.completeness_status
    FROM category_tasks t
    LEFT JOIN LATERAL (
      SELECT completeness_status
      FROM price_quality_checks
      WHERE task_id = t.task_id
      ORDER BY checked_at DESC
      LIMIT 1
    ) q ON true
    WHERE t.run_id = $1
    ORDER BY t.category_order ASC, t.created_at ASC
    `,
    [runId]
  );
  const run = runResult.rows[0];
  const manifestResult = run.scope_manifest_id
    ? await db.query(`SELECT categories FROM scope_manifests WHERE scope_manifest_id = $1`, [run.scope_manifest_id])
    : { rows: [] as any[] };
  const manifestCategories = (manifestResult.rows[0]?.categories || []) as Array<{ canonicalCategoryKey: string }>;
  const taskByKey = new Map(taskResult.rows.map((row) => [row.canonical_category_key, row]));
  const selectedRows = manifestCategories.length
    ? manifestCategories.map((category) => taskByKey.get(category.canonicalCategoryKey) || {
        status: "pending",
        collected_items: 0,
        expected_items: null,
        cursor: {},
        completeness_status: null
      })
    : taskResult.rows;
  const scopeMatches = manifestCategories.length > 0
    && manifestCategories.length === taskResult.rows.length
    && taskResult.rows.every((row) => manifestCategories.some(
      (category) => category.canonicalCategoryKey === row.canonical_category_key
    ));
  const calculated = applyScopeGate(calculateRunProgress(selectedRows.map((row) => ({
    status: row.status,
    collectedItems: Number(row.collected_items || 0),
    expectedItems: row.expected_items === null ? undefined : Number(row.expected_items),
    qualityStatus: row.completeness_status || undefined,
    exclusionEvidence: row.cursor?.exclusionEvidence === true
  }))), manifestCategories.length > 0, scopeMatches);
  return {
    runId: run.run_id,
    storeId: run.store_id,
    storeName: run.store_name,
    runLabel: run.run_label,
    ...calculated,
    updatedAt: run.updated_at.toISOString()
  };
}

export async function listRunProgress(db: Pool): Promise<RunProgressRecord[]> {
  const runs = await db.query(`SELECT run_id FROM store_runs ORDER BY created_at DESC LIMIT 200`);
  return (await Promise.all(runs.rows.map((row) => getRunProgress(db, row.run_id))))
    .filter((row): row is RunProgressRecord => Boolean(row));
}

export async function aggregateAllActiveStoreRuns(db: Pool): Promise<number> {
  const result = await db.query(`SELECT run_id FROM store_runs WHERE status <> 'cancelled'`);
  await Promise.all(result.rows.map((row) => aggregateStoreRun(db, row.run_id)));
  return result.rows.length;
}

export async function aggregateStoreRun(db: Pool, runId: string): Promise<RunProgressRecord | null> {
  const progress = await getRunProgress(db, runId);
  if (!progress) return null;
  const current = await db.query(`SELECT status FROM store_runs WHERE run_id = $1`, [runId]);
  if (current.rows[0]?.status === "cancelled") return { ...progress, status: "cancelled" };
  await db.query(
    `
    UPDATE store_runs SET
      status = $2,
      started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
      completed_at = CASE WHEN $2 = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
      updated_at = now()
    WHERE run_id = $1
    `,
    [runId, progress.status]
  );
  return getRunProgress(db, runId);
}

function resolveRunStatus(tasks: RunProgressTaskInput[], deliverable: boolean): RunStatus {
  if (!tasks.length || tasks.every((task) => task.status === "pending")) return "planned";
  if (deliverable) return "completed";
  if (tasks.every((task) => task.status === "failed")) return "failed";
  if (tasks.every((task) => ["paused", "manual_required"].includes(task.status))) return "paused";
  return "running";
}
