import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CreatedWorkerEnrollmentToken,
  CreateWorkerEnrollmentTokenInput,
  WorkerEnrollmentRequest,
  WorkerEnrollmentResult
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export interface EnrollmentTokenState {
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
  revokedAt: Date | null;
}

export type EnrollmentEligibility =
  | { eligible: true }
  | { eligible: false; reason: "expired" | "revoked" | "exhausted" };

export function createOpaqueToken(prefix: "enr" | "rwk"): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function secretMatchesHash(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function evaluateEnrollmentToken(
  token: EnrollmentTokenState,
  now = new Date()
): EnrollmentEligibility {
  if (token.revokedAt) return { eligible: false, reason: "revoked" };
  if (token.expiresAt.getTime() <= now.getTime()) return { eligible: false, reason: "expired" };
  if (token.usedCount >= token.maxUses) return { eligible: false, reason: "exhausted" };
  return { eligible: true };
}

export async function createWorkerEnrollmentToken(
  db: Pool,
  input: CreateWorkerEnrollmentTokenInput
): Promise<CreatedWorkerEnrollmentToken> {
  const label = input.label?.trim();
  if (!label) throw new Error("enrollment_label_required");
  const expiresInMinutes = boundedInteger(input.expiresInMinutes ?? 60, 5, 1440, "invalid_enrollment_expiry");
  const maxUses = boundedInteger(input.maxUses ?? 1, 1, 10, "invalid_enrollment_max_uses");
  const enrollmentToken = createOpaqueToken("enr");
  const result = await db.query(`
    INSERT INTO worker_enrollment_tokens (token_hash, label, expires_at, max_uses)
    VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4)
    RETURNING token_id, label, expires_at, max_uses
  `, [hashSecret(enrollmentToken), label, expiresInMinutes, maxUses]);
  const row = result.rows[0];
  return {
    tokenId: row.token_id,
    enrollmentToken,
    label: row.label,
    expiresAt: row.expires_at.toISOString(),
    maxUses: row.max_uses
  };
}

export async function enrollWorker(
  db: Pool,
  input: WorkerEnrollmentRequest,
  masterBaseUrl: string
): Promise<WorkerEnrollmentResult> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tokenResult = await client.query(`
      SELECT token_id, expires_at, max_uses, used_count, revoked_at
      FROM worker_enrollment_tokens
      WHERE token_hash = $1
      FOR UPDATE
    `, [hashSecret(input.enrollmentToken)]);
    const token = tokenResult.rows[0];
    if (!token) throw new Error("invalid_enrollment_token");
    const eligibility = evaluateEnrollmentToken({
      expiresAt: token.expires_at,
      maxUses: token.max_uses,
      usedCount: token.used_count,
      revokedAt: token.revoked_at
    });
    if (!eligibility.eligible) throw new Error(`enrollment_token_${eligibility.reason}`);

    const workerId = `worker-${randomUUID()}`;
    const workerToken = createOpaqueToken("rwk");
    await client.query(`
      INSERT INTO workers (
        worker_id, machine_label, hostname, os, agent_version, status, network_mode,
        codex_operator, capabilities, remote_desktop, last_seen_at
      ) VALUES ($1,$2,$3,$4,$5,'offline',$6,false,$7,$8,now())
    `, [
      workerId,
      requiredText(input.machineLabel, "machine_label_required"),
      requiredText(input.hostname, "hostname_required"),
      requiredText(input.os, "worker_os_required"),
      requiredText(input.agentVersion, "agent_version_required"),
      input.networkMode,
      JSON.stringify(input.capabilities || []),
      JSON.stringify(input.remoteDesktop || { provider: "none", status: "unknown" })
    ]);
    await client.query(`
      INSERT INTO worker_credentials (worker_id, token_hash, version)
      VALUES ($1, $2, 1)
    `, [workerId, hashSecret(workerToken)]);
    await client.query(`
      UPDATE worker_enrollment_tokens SET used_count = used_count + 1 WHERE token_id = $1
    `, [token.token_id]);
    await client.query("COMMIT");
    return { workerId, workerToken, masterBaseUrl, enrolledAt: new Date().toISOString() };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function findActiveWorkerByTokenHash(db: Pool, tokenHash: string): Promise<string | undefined> {
  const result = await db.query(`
    UPDATE worker_credentials
    SET last_used_at = now()
    WHERE token_hash = $1 AND revoked_at IS NULL
    RETURNING worker_id
  `, [tokenHash]);
  return result.rows[0]?.worker_id;
}

export async function rotateWorkerCredential(db: Pool, workerId: string): Promise<{ workerToken: string; version: number }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const worker = await client.query(`SELECT worker_id FROM workers WHERE worker_id = $1 FOR UPDATE`, [workerId]);
    if (!worker.rows[0]) throw new Error("worker_not_found");
    const versionResult = await client.query(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version FROM worker_credentials WHERE worker_id = $1
    `, [workerId]);
    const version = Number(versionResult.rows[0].version);
    const workerToken = createOpaqueToken("rwk");
    await client.query(`UPDATE worker_credentials SET revoked_at = now() WHERE worker_id = $1 AND revoked_at IS NULL`, [workerId]);
    await client.query(`
      INSERT INTO worker_credentials (worker_id, token_hash, version) VALUES ($1, $2, $3)
    `, [workerId, hashSecret(workerToken), version]);
    await client.query("COMMIT");
    return { workerToken, version };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeWorkerCredentials(db: Pool, workerId: string): Promise<number> {
  const result = await db.query(`
    UPDATE worker_credentials SET revoked_at = now()
    WHERE worker_id = $1 AND revoked_at IS NULL
  `, [workerId]);
  return result.rowCount || 0;
}

function requiredText(value: string, errorCode: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function boundedInteger(value: number, min: number, max: number, errorCode: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(errorCode);
  return value;
}
