import type {
  CdpCommandRecord,
  ClaimCdpCommandInput,
  CompleteCdpCommandInput,
  CreateCdpCommandInput
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { upsertCdpEndpoint } from "./cdp-endpoints.js";

interface CommandSlotBinding {
  workerId: string;
  port: number;
  status: string;
  profileId?: string;
  accountId?: string;
  targetStoreId?: string;
}

export function buildCdpCommandEndpointId(workerId: string, port: number): string {
  return `${workerId}:${port}`;
}

export function normalizeCdpCommandInput(input: CreateCdpCommandInput): CreateCdpCommandInput {
  return {
    ...input,
    endpointId: input.slotId ? `slot:${input.slotId}` : (input.endpointId || buildCdpCommandEndpointId(input.workerId, input.port)),
    profilePath: input.profilePath || `browser-profiles/${input.profileId}`,
    proxyMode: input.proxyMode || "system"
  };
}

export function validateCdpCommandSlot(input: CreateCdpCommandInput, slot: CommandSlotBinding): void {
  if (slot.status === "retired") throw new Error("slot_retired");
  if (slot.workerId !== input.workerId) throw new Error("slot_worker_mismatch");
  if (slot.port !== input.port) throw new Error("slot_port_mismatch");
  if (slot.profileId && slot.profileId !== input.profileId) throw new Error("slot_profile_mismatch");
  if (slot.accountId && slot.accountId !== input.accountId) throw new Error("slot_account_mismatch");
  if (slot.targetStoreId && slot.targetStoreId !== input.targetStoreId) throw new Error("slot_store_mismatch");
}

export function canClaimCdpCommand(
  command: Pick<CdpCommandRecord, "status" | "workerId">,
  workerId: string
): boolean {
  return command.status === "pending" && command.workerId === workerId;
}

export function isCdpCommandClaimable(
  command: Pick<CdpCommandRecord, "status" | "claimUntil">,
  now = new Date()
): boolean {
  if (command.status === "pending") return true;
  return command.status === "claimed" && Boolean(command.claimUntil) && new Date(command.claimUntil!).getTime() <= now.getTime();
}

export async function createCdpCommand(db: Pool, rawInput: CreateCdpCommandInput): Promise<CdpCommandRecord> {
  const input = normalizeCdpCommandInput(rawInput);
  if (input.slotId) {
    const slotResult = await db.query(`SELECT * FROM browser_slots WHERE slot_id = $1`, [input.slotId]);
    const row = slotResult.rows[0];
    if (!row) throw new Error("slot_not_found");
    validateCdpCommandSlot(input, {
      workerId: row.worker_id,
      port: row.port,
      status: row.status,
      profileId: row.profile_id || undefined,
      accountId: row.account_id || undefined,
      targetStoreId: row.target_store_id || undefined
    });
  }
  const result = await db.query(
    `
    INSERT INTO cdp_commands (
      slot_id, worker_id, action, endpoint_id, port, profile_id, profile_path, account_id,
      account_display_name, masked_login, operator_owner, target_store_id, target_store_name,
      launch_url, chrome_executable, proxy_mode, note
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *
    `,
    [
      input.slotId || null,
      input.workerId,
      input.action,
      input.endpointId,
      input.port,
      input.profileId,
      input.profilePath,
      input.accountId || null,
      input.accountDisplayName || null,
      input.maskedLogin || null,
      input.operatorOwner || null,
      input.targetStoreId || null,
      input.targetStoreName || null,
      input.launchUrl || null,
      input.chromeExecutable || null,
      input.proxyMode || "system",
      input.note || null
    ]
  );
  return mapCdpCommand(result.rows[0]);
}

export async function listCdpCommands(db: Pool, workerId?: string): Promise<CdpCommandRecord[]> {
  const result = await db.query(
    `
    SELECT *
    FROM cdp_commands
    WHERE ($1::text IS NULL OR worker_id = $1)
    ORDER BY created_at DESC
    LIMIT 200
    `,
    [workerId || null]
  );
  return result.rows.map(mapCdpCommand);
}

export async function claimNextCdpCommand(db: Pool, input: ClaimCdpCommandInput): Promise<{ command?: CdpCommandRecord }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      `
      SELECT command_id
      FROM cdp_commands
      WHERE worker_id = $1
        AND (status = 'pending' OR (status = 'claimed' AND claim_until <= now()))
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
      `,
      [input.workerId]
    );
    if (!selected.rows[0]) {
      await client.query("COMMIT");
      return {};
    }
    const updated = await client.query(
      `
      UPDATE cdp_commands SET
        status = 'claimed',
        claimed_by = $2,
        claimed_at = now(),
        claim_until = now() + interval '5 minutes',
        claim_generation = claim_generation + 1,
        updated_at = now()
      WHERE command_id = $1
      RETURNING *
      `,
      [selected.rows[0].command_id, input.workerId]
    );
    await client.query("COMMIT");
    return { command: mapCdpCommand(updated.rows[0]) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeCdpCommand(
  db: Pool,
  commandId: string,
  input: CompleteCdpCommandInput,
  expectedWorkerId?: string
): Promise<CdpCommandRecord | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      UPDATE cdp_commands SET
        status = $2,
        completed_at = now(),
        last_error = $3,
        updated_at = now()
      WHERE command_id = $1
        AND status = 'claimed'
        AND claimed_by = $4
        AND claim_generation = $5
        AND claim_until > now()
      RETURNING *
      `,
      [commandId, input.status, input.lastError || null, expectedWorkerId || null, input.claimGeneration]
    );
    const command = result.rows[0] ? mapCdpCommand(result.rows[0]) : null;
    if (command && input.status === "completed" && input.endpoint) {
      await upsertCdpEndpoint(client, command.workerId, input.endpoint);
    }
    await client.query("COMMIT");
    return command;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function mapCdpCommand(row: any): CdpCommandRecord {
  return {
    commandId: row.command_id,
    slotId: row.slot_id || undefined,
    workerId: row.worker_id,
    action: row.action,
    status: row.status,
    endpointId: row.endpoint_id || undefined,
    port: row.port,
    profileId: row.profile_id,
    profilePath: row.profile_path || undefined,
    accountId: row.account_id || undefined,
    accountDisplayName: row.account_display_name || undefined,
    maskedLogin: row.masked_login || undefined,
    operatorOwner: row.operator_owner || undefined,
    targetStoreId: row.target_store_id || undefined,
    targetStoreName: row.target_store_name || undefined,
    launchUrl: row.launch_url || undefined,
    chromeExecutable: row.chrome_executable || undefined,
    proxyMode: row.proxy_mode,
    note: row.note || undefined,
    claimedBy: row.claimed_by || undefined,
    claimedAt: row.claimed_at?.toISOString(),
    claimUntil: row.claim_until?.toISOString(),
    claimGeneration: row.claim_generation || 0,
    completedAt: row.completed_at?.toISOString(),
    lastError: row.last_error || undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
