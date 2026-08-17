import type {
  BindBrowserSlotInput,
  BrowserSlotRecord,
  CreateBrowserSlotInput,
  UpdateBrowserSlotInput
} from "@retail-orchestrator/shared";
import type { Pool, PoolClient } from "pg";

interface BindableSlot {
  workerId: string;
  targetStoreId?: string | null;
  status: string;
}

interface BindableAccount {
  accountId: string;
  workerId: string;
  profileId: string;
  status: string;
  riskLevel: string;
}

interface BindableProfile {
  profileId: string;
  workerId: string;
  status: string;
}

interface BindableStore {
  storeId: string;
  status: string;
}

export interface AccountChangeNotice {
  changed: boolean;
  previousAccountId?: string;
  accountId: string;
  accountDisplayName: string;
  maskedLogin: string;
  operatorOwner: string;
  localIdentityPageRequired: boolean;
  message: string;
}

export function buildAccountChangeNotice(input: {
  previousAccountId?: string;
  accountId: string;
  accountDisplayName?: string;
  maskedLogin?: string;
  operatorOwner?: string;
}): AccountChangeNotice {
  const accountDisplayName = input.accountDisplayName?.trim() || input.accountId;
  const maskedLogin = input.maskedLogin?.trim() || "手机号待在标识页确认";
  const operatorOwner = input.operatorOwner?.trim() || accountDisplayName;
  return {
    changed: Boolean(input.previousAccountId && input.previousAccountId !== input.accountId),
    previousAccountId: input.previousAccountId,
    accountId: input.accountId,
    accountDisplayName,
    maskedLogin,
    operatorOwner,
    localIdentityPageRequired: true,
    message: `当前账号：${maskedLogin}，所属人：${operatorOwner}。请在本机 CDP 标识页填写并保存完整手机号；Codex、Master 日志和群通知只显示脱敏手机号。`
  };
}

export function validateRemoteDesktopTarget(target: string): string {
  const normalized = target.trim();
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._:@-]+$/.test(normalized)) {
    throw new Error("invalid_remote_desktop_target");
  }
  return normalized;
}

export function validateBrowserSlotBinding(
  slot: BindableSlot,
  account: BindableAccount,
  profile: BindableProfile,
  store: BindableStore
): void {
  if (slot.status === "retired") throw new Error("slot_retired");
  if (account.workerId !== slot.workerId || profile.workerId !== slot.workerId) {
    throw new Error("slot_worker_mismatch");
  }
  if (account.profileId !== profile.profileId) throw new Error("account_profile_mismatch");
  if (!["safe", "cooldown"].includes(account.status) || !["normal", "watch"].includes(account.riskLevel)) {
    throw new Error("account_not_bindable");
  }
  if (profile.status !== "safe") throw new Error("profile_not_bindable");
  if (store.status !== "active") throw new Error("store_not_bindable");
  if (slot.targetStoreId && slot.targetStoreId !== store.storeId) throw new Error("slot_store_mismatch");
}

export async function listBrowserSlots(db: Pool, workerId?: string): Promise<BrowserSlotRecord[]> {
  const result = await db.query(`
    SELECT * FROM browser_slots
    WHERE ($1::text IS NULL OR worker_id = $1)
    ORDER BY worker_id, label
  `, [workerId || null]);
  return result.rows.map(mapBrowserSlot);
}

export async function getBrowserSlot(db: Pool | PoolClient, slotId: string): Promise<BrowserSlotRecord | null> {
  const result = await db.query(`SELECT * FROM browser_slots WHERE slot_id = $1`, [slotId]);
  return result.rows[0] ? mapBrowserSlot(result.rows[0]) : null;
}

export async function createBrowserSlot(db: Pool, input: CreateBrowserSlotInput): Promise<BrowserSlotRecord> {
  const label = input.label?.trim();
  if (!label) throw new Error("slot_label_required");
  validatePort(input.port);
  const remoteDesktopTarget = input.remoteDesktopTarget
    ? validateRemoteDesktopTarget(input.remoteDesktopTarget)
    : null;
  const result = await db.query(`
    INSERT INTO browser_slots (worker_id, label, port, remote_desktop_target)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [input.workerId, label, input.port, remoteDesktopTarget]);
  return mapBrowserSlot(result.rows[0]);
}

export async function updateBrowserSlot(
  db: Pool,
  slotId: string,
  input: UpdateBrowserSlotInput
): Promise<BrowserSlotRecord | null> {
  if (input.label !== undefined && !input.label.trim()) throw new Error("slot_label_required");
  if (input.port !== undefined) validatePort(input.port);
  const remoteDesktopTarget = input.remoteDesktopTarget
    ? validateRemoteDesktopTarget(input.remoteDesktopTarget)
    : null;
  const result = await db.query(`
    UPDATE browser_slots SET
      label = COALESCE($2, label),
      port = COALESCE($3, port),
      status = COALESCE($4, status),
      remote_desktop_target = CASE WHEN $5::boolean THEN $6 ELSE remote_desktop_target END,
      updated_at = now()
    WHERE slot_id = $1
    RETURNING *
  `, [
    slotId,
    input.label?.trim() || null,
    input.port ?? null,
    input.status || null,
    "remoteDesktopTarget" in input,
    remoteDesktopTarget
  ]);
  return result.rows[0] ? mapBrowserSlot(result.rows[0]) : null;
}

export async function bindBrowserSlot(
  db: Pool,
  slotId: string,
  input: BindBrowserSlotInput
): Promise<BrowserSlotRecord> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const slotResult = await client.query(`SELECT * FROM browser_slots WHERE slot_id = $1 FOR UPDATE`, [slotId]);
    if (!slotResult.rows[0]) throw new Error("slot_not_found");
    const accountResult = await client.query(`SELECT * FROM accounts WHERE account_id = $1 FOR UPDATE`, [input.accountId]);
    if (!accountResult.rows[0]) throw new Error("account_not_found");
    const profileResult = await client.query(`SELECT * FROM profiles WHERE profile_id = $1 FOR UPDATE`, [input.profileId]);
    if (!profileResult.rows[0]) throw new Error("profile_not_found");
    const storeResult = await client.query(`SELECT * FROM stores WHERE store_id = $1`, [input.targetStoreId]);
    if (!storeResult.rows[0]) throw new Error("store_not_found");

    validateBrowserSlotBinding(
      {
        workerId: slotResult.rows[0].worker_id,
        targetStoreId: slotResult.rows[0].target_store_id,
        status: slotResult.rows[0].status
      },
      {
        accountId: accountResult.rows[0].account_id,
        workerId: accountResult.rows[0].worker_id,
        profileId: accountResult.rows[0].profile_id,
        status: accountResult.rows[0].status,
        riskLevel: accountResult.rows[0].risk_level
      },
      {
        profileId: profileResult.rows[0].profile_id,
        workerId: profileResult.rows[0].worker_id,
        status: profileResult.rows[0].status
      },
      { storeId: storeResult.rows[0].store_id, status: storeResult.rows[0].status }
    );

    const updated = await client.query(`
      UPDATE browser_slots SET
        account_id = $2, profile_id = $3, target_store_id = $4,
        status = CASE WHEN status = 'unknown' THEN 'idle' ELSE status END,
        updated_at = now()
      WHERE slot_id = $1
      RETURNING *
    `, [slotId, input.accountId, input.profileId, input.targetStoreId]);
    await client.query("COMMIT");
    return mapBrowserSlot(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw mapConstraintError(error);
  } finally {
    client.release();
  }
}

export async function unbindBrowserSlot(db: Pool, slotId: string): Promise<BrowserSlotRecord | null> {
  const result = await db.query(`
    UPDATE browser_slots SET
      account_id = NULL, profile_id = NULL, target_store_id = NULL,
      status = CASE WHEN status = 'retired' THEN status ELSE 'idle' END,
      updated_at = now()
    WHERE slot_id = $1
    RETURNING *
  `, [slotId]);
  return result.rows[0] ? mapBrowserSlot(result.rows[0]) : null;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid_slot_port");
}

function mapConstraintError(error: unknown): Error {
  const code = (error as { code?: string }).code;
  if (code === "23505") return new Error("slot_resource_already_bound");
  return error instanceof Error ? error : new Error(String(error));
}

function mapBrowserSlot(row: any): BrowserSlotRecord {
  return {
    slotId: row.slot_id,
    workerId: row.worker_id,
    label: row.label,
    port: row.port,
    status: row.status,
    profileId: row.profile_id || undefined,
    accountId: row.account_id || undefined,
    targetStoreId: row.target_store_id || undefined,
    remoteDesktopTarget: row.remote_desktop_target || undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
