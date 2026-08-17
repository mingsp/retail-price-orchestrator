import type {
  AccountPoolRecord,
  AccountPoolStatus,
  CreateAccountPoolInput,
  RiskLevel,
  UpdateAccountPoolInput
} from "@retail-orchestrator/shared";
import { accountPoolStatuses } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

const riskLevels = new Set<RiskLevel>(["normal", "watch", "blocked"]);
const poolStatuses = new Set<AccountPoolStatus>(accountPoolStatuses);

export function maskLoginIdentifier(value: string): string {
  const normalized = requiredText(value, "masked_login_required", 64);
  if (/^\d{7,}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  }
  return normalized;
}

export function normalizeCreateAccountPoolInput(input: CreateAccountPoolInput): CreateAccountPoolInput {
  return {
    displayName: requiredText(input?.displayName, "display_name_required", 80),
    maskedLogin: maskLoginIdentifier(input?.maskedLogin),
    operatorOwner: requiredText(input?.operatorOwner, "operator_owner_required", 80),
    note: optionalText(input?.note, 500)
  };
}

export function normalizeUpdateAccountPoolInput(input: UpdateAccountPoolInput): UpdateAccountPoolInput {
  const normalized: UpdateAccountPoolInput = {};
  if (input.displayName !== undefined) normalized.displayName = requiredText(input.displayName, "display_name_required", 80);
  if (input.maskedLogin !== undefined) normalized.maskedLogin = maskLoginIdentifier(input.maskedLogin);
  if (input.operatorOwner !== undefined) normalized.operatorOwner = requiredText(input.operatorOwner, "operator_owner_required", 80);
  if (input.status !== undefined) {
    if (!poolStatuses.has(input.status)) throw new Error("invalid_account_pool_status");
    normalized.status = input.status;
  }
  if (input.riskLevel !== undefined) {
    if (!riskLevels.has(input.riskLevel)) throw new Error("invalid_risk_level");
    normalized.riskLevel = input.riskLevel;
  }
  if (input.note !== undefined) normalized.note = input.note === null ? null : optionalText(input.note, 500);
  if (input.availableAfter !== undefined) normalized.availableAfter = normalizeOptionalTimestamp(input.availableAfter);
  return normalized;
}

export async function listAccountPool(db: Pool): Promise<AccountPoolRecord[]> {
  const result = await db.query(`
    SELECT
      pool.*,
      COALESCE(runtime.worker_id, pool.assigned_worker_id) AS effective_worker_id,
      worker.machine_label AS assigned_worker_label,
      COALESCE(active.store_id, runtime.current_store_id, pool.assigned_store_id) AS effective_store_id,
      COALESCE(active.store_name, runtime.current_store_name, assigned_store.name) AS effective_store_name,
      COALESCE(active.category_name, runtime.current_category_name) AS effective_category_name,
      runtime.profile_id,
      runtime.cdp_port,
      usage.last_used_at,
      COALESCE(usage.use_count, 0)::integer AS use_count,
      COALESCE(risk.risk_count, 0)::integer AS risk_count,
      risk.last_risk_at
    FROM account_pool pool
    LEFT JOIN accounts runtime ON runtime.account_id = pool.account_id
    LEFT JOIN workers worker ON worker.worker_id = COALESCE(runtime.worker_id, pool.assigned_worker_id)
    LEFT JOIN stores assigned_store ON assigned_store.store_id = pool.assigned_store_id
    LEFT JOIN LATERAL (
      SELECT t.store_id, s.name AS store_name, t.category_name,
             COALESCE(t.last_progress_at, t.updated_at) AS observed_at
      FROM category_tasks t
      JOIN stores s ON s.store_id = t.store_id
      WHERE t.assigned_account_id = pool.account_id
        AND t.status IN ('assigned','running','collecting','captured','uploading','structuring','validating')
      ORDER BY COALESCE(t.last_progress_at, t.updated_at) DESC
      LIMIT 1
    ) active ON true
    LEFT JOIN LATERAL (
      SELECT MAX(COALESCE(t.last_progress_at, t.updated_at)) AS last_used_at,
             COUNT(DISTINCT t.run_id) FILTER (WHERE t.collected_items > 0) AS use_count
      FROM category_tasks t
      WHERE t.assigned_account_id = pool.account_id
        AND t.collected_items > 0
    ) usage ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS risk_count, MAX(created_at) AS last_risk_at
      FROM risk_events r
      WHERE r.account_id = pool.account_id
    ) risk ON true
    ORDER BY
      CASE pool.status
        WHEN 'in_use' THEN 1 WHEN 'reserved' THEN 2 WHEN 'available' THEN 3
        WHEN 'cooldown' THEN 4 WHEN 'risk' THEN 5 ELSE 6
      END,
      pool.updated_at DESC
  `);
  return result.rows.map(mapAccountPoolRow);
}

export async function getAccountPoolRecord(db: Pool, accountId: string): Promise<AccountPoolRecord | null> {
  const records = await listAccountPool(db);
  return records.find((record) => record.accountId === accountId) || null;
}

export async function createAccountPoolRecord(db: Pool, input: CreateAccountPoolInput): Promise<AccountPoolRecord> {
  const normalized = normalizeCreateAccountPoolInput(input);
  const result = await db.query(`
    INSERT INTO account_pool (display_name, masked_login, operator_owner, note)
    VALUES ($1, $2, $3, $4)
    RETURNING account_id
  `, [normalized.displayName, normalized.maskedLogin, normalized.operatorOwner, normalized.note || null]);
  const created = await getAccountPoolRecord(db, result.rows[0].account_id);
  if (!created) throw new Error("account_pool_create_failed");
  return created;
}

export async function updateAccountPoolRecord(
  db: Pool,
  accountId: string,
  input: UpdateAccountPoolInput
): Promise<AccountPoolRecord | null> {
  const normalized = normalizeUpdateAccountPoolInput(input || {});
  const has = (key: keyof UpdateAccountPoolInput) => Object.prototype.hasOwnProperty.call(normalized, key);
  const result = await db.query(`
    UPDATE account_pool SET
      display_name = CASE WHEN $2::boolean THEN $3 ELSE display_name END,
      masked_login = CASE WHEN $4::boolean THEN $5 ELSE masked_login END,
      operator_owner = CASE WHEN $6::boolean THEN $7 ELSE operator_owner END,
      status = CASE WHEN $8::boolean THEN $9 ELSE status END,
      risk_level = CASE WHEN $10::boolean THEN $11 ELSE risk_level END,
      note = CASE WHEN $12::boolean THEN $13 ELSE note END,
      available_after = CASE WHEN $14::boolean THEN $15::timestamptz ELSE available_after END,
      updated_at = now()
    WHERE account_id = $1
    RETURNING account_id
  `, [
    accountId,
    has("displayName"), normalized.displayName || null,
    has("maskedLogin"), normalized.maskedLogin || null,
    has("operatorOwner"), normalized.operatorOwner || null,
    has("status"), normalized.status || null,
    has("riskLevel"), normalized.riskLevel || null,
    has("note"), normalized.note ?? null,
    has("availableAfter"), normalized.availableAfter ?? null
  ]);
  if (!result.rowCount) return null;
  return getAccountPoolRecord(db, accountId);
}

function mapAccountPoolRow(row: any): AccountPoolRecord {
  return {
    accountId: row.account_id,
    displayName: row.display_name,
    maskedLogin: row.masked_login,
    operatorOwner: row.operator_owner,
    status: row.status,
    riskLevel: row.risk_level,
    note: row.note || undefined,
    availableAfter: row.available_after?.toISOString?.() || row.available_after || undefined,
    assignedWorkerId: row.effective_worker_id || undefined,
    assignedWorkerLabel: row.assigned_worker_label || undefined,
    currentStoreId: row.effective_store_id || undefined,
    currentStoreName: row.effective_store_name || undefined,
    currentCategoryName: row.effective_category_name || undefined,
    profileId: row.profile_id || undefined,
    cdpPort: row.cdp_port || undefined,
    lastUsedAt: row.last_used_at?.toISOString?.() || row.last_used_at || undefined,
    useCount: Number(row.use_count || 0),
    riskCount: Number(row.risk_count || 0),
    lastRiskAt: row.last_risk_at?.toISOString?.() || row.last_risk_at || undefined,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

function requiredText(value: unknown, errorCode: string, maxLength: number): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(errorCode);
  if (normalized.length > maxLength) throw new Error("value_too_long");
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error("value_too_long");
  return normalized;
}

function normalizeOptionalTimestamp(value: string | null): string | null {
  if (value === null || !String(value).trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid_available_after");
  return parsed.toISOString();
}
