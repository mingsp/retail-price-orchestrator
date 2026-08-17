import type { AccountSnapshot, WorkerHeartbeatPayload, WorkerStatus, WorkerStatusRow } from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { accountToCdpEndpoint, listCdpEndpoints, upsertCdpEndpoints } from "./cdp-endpoints.js";

export async function upsertWorkerSnapshot(db: Pool, payload: WorkerHeartbeatPayload): Promise<void> {
  const { worker, accounts } = payload;
  await db.query(
    `
    INSERT INTO workers (
      worker_id, machine_label, hostname, os, agent_version, status,
      network_mode, codex_operator, capabilities, latest_log_summary,
      boot_id, started_at, current_ip, disk_free_bytes, clock_offset_ms, remote_desktop, execution_snapshot,
      last_seen_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),now())
    ON CONFLICT (worker_id) DO UPDATE SET
      machine_label = EXCLUDED.machine_label,
      hostname = EXCLUDED.hostname,
      os = EXCLUDED.os,
      agent_version = EXCLUDED.agent_version,
      status = EXCLUDED.status,
      network_mode = EXCLUDED.network_mode,
      codex_operator = EXCLUDED.codex_operator,
      capabilities = EXCLUDED.capabilities,
      latest_log_summary = EXCLUDED.latest_log_summary,
      boot_id = EXCLUDED.boot_id,
      started_at = EXCLUDED.started_at,
      current_ip = EXCLUDED.current_ip,
      disk_free_bytes = EXCLUDED.disk_free_bytes,
      clock_offset_ms = EXCLUDED.clock_offset_ms,
      remote_desktop = EXCLUDED.remote_desktop,
      execution_snapshot = EXCLUDED.execution_snapshot,
      last_seen_at = now(),
      updated_at = now()
    `,
    [
      worker.workerId,
      worker.machineLabel,
      worker.hostname,
      worker.os,
      worker.agentVersion,
      worker.status,
      worker.networkMode,
      worker.codexOperator,
      JSON.stringify(worker.capabilities),
      payload.latestLogSummary || null,
      worker.bootId || null,
      worker.startedAt || null,
      worker.currentIp || null,
      worker.diskFreeBytes ?? null,
      worker.clockOffsetMs ?? null,
      JSON.stringify(worker.remoteDesktop || { provider: "none", status: "unknown" }),
      payload.execution ? JSON.stringify(payload.execution) : null
    ]
  );

  await db.query(
    `
    INSERT INTO worker_heartbeats (worker_id, sent_at, payload)
    SELECT $1, $2, $3
    WHERE NOT EXISTS (
      SELECT 1 FROM worker_heartbeats
      WHERE worker_id = $1 AND received_at >= now() - interval '1 minute'
    )
    `,
    [worker.workerId, payload.sentAt, JSON.stringify(payload)]
  );

  for (const account of accounts) {
    await upsertAccount(db, worker.workerId, account);
  }

  const cdpEndpoints = payload.cdpEndpoints?.length
    ? payload.cdpEndpoints
    : accounts.map((account) => accountToCdpEndpoint(worker.workerId, account));
  await upsertCdpEndpoints(db, worker.workerId, cdpEndpoints);
}

export async function pruneWorkerHeartbeats(db: Pool, retentionDays = 14): Promise<number> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) throw new Error("invalid_heartbeat_retention_days");
  const result = await db.query(
    `DELETE FROM worker_heartbeats WHERE received_at < now() - ($1 || ' days')::interval`,
    [retentionDays]
  );
  return result.rowCount || 0;
}

async function upsertAccount(db: Pool, workerId: string, account: AccountSnapshot): Promise<void> {
  await db.query(
    `
    INSERT INTO accounts (
      account_id, worker_id, display_name, masked_login, status, risk_level,
      profile_id, cdp_port, cdp_endpoint, current_store_id, current_store_name,
      current_category_name, last_verified_at, last_risk_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
    ON CONFLICT (account_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      display_name = EXCLUDED.display_name,
      masked_login = EXCLUDED.masked_login,
      status = CASE
        WHEN accounts.status = 'manual_required'
          AND accounts.risk_level IN ('watch', 'high')
          AND EXCLUDED.status IN ('safe', 'running')
        THEN accounts.status
        WHEN accounts.status = 'safe'
          AND accounts.risk_level = 'watch'
          AND EXCLUDED.status = 'manual_required'
          AND EXCLUDED.risk_level = 'high'
        THEN accounts.status
        ELSE EXCLUDED.status
      END,
      risk_level = CASE
        WHEN accounts.status = 'manual_required'
          AND accounts.risk_level IN ('watch', 'high')
          AND EXCLUDED.status IN ('safe', 'running')
        THEN accounts.risk_level
        WHEN accounts.status = 'safe'
          AND accounts.risk_level = 'watch'
          AND EXCLUDED.status = 'manual_required'
          AND EXCLUDED.risk_level = 'high'
        THEN accounts.risk_level
        ELSE EXCLUDED.risk_level
      END,
      profile_id = EXCLUDED.profile_id,
      cdp_port = EXCLUDED.cdp_port,
      cdp_endpoint = EXCLUDED.cdp_endpoint,
      current_store_id = EXCLUDED.current_store_id,
      current_store_name = EXCLUDED.current_store_name,
      current_category_name = EXCLUDED.current_category_name,
      last_verified_at = EXCLUDED.last_verified_at,
      last_risk_at = EXCLUDED.last_risk_at,
      updated_at = now()
    `,
    [
      account.accountId,
      workerId,
      account.displayName,
      account.maskedLogin || null,
      account.status,
      account.riskLevel,
      account.profileId,
      account.cdpPort,
      account.cdpEndpoint || `http://127.0.0.1:${account.cdpPort}`,
      account.currentStoreId || null,
      account.currentStoreName || null,
      account.currentCategoryName || null,
      account.lastVerifiedAt || null,
      account.lastRiskAt || null
    ]
  );

  await db.query(
    `
    INSERT INTO profiles (
      profile_id, worker_id, account_id, profile_path, cdp_port, cdp_endpoint, status,
      last_risk_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
    ON CONFLICT (profile_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      account_id = EXCLUDED.account_id,
      profile_path = EXCLUDED.profile_path,
      cdp_port = EXCLUDED.cdp_port,
      cdp_endpoint = EXCLUDED.cdp_endpoint,
      status = EXCLUDED.status,
      last_risk_at = EXCLUDED.last_risk_at,
      updated_at = now()
    `,
    [
      account.profileId,
      workerId,
      account.accountId,
      account.profilePath,
      account.cdpPort,
      account.cdpEndpoint || `http://127.0.0.1:${account.cdpPort}`,
      account.profileStatus,
      account.lastRiskAt || null
    ]
  );
}

export function shouldPruneMissingHeartbeatResources(
  snapshotMode: "incremental" | undefined
): boolean {
  // Heartbeats are observations, not deletion commands. Resource retirement must be explicit.
  return false;
}

export async function listWorkers(db: Pool): Promise<WorkerStatusRow[]> {
  const workers = await db.query(`
    SELECT * FROM workers ORDER BY worker_id ASC
  `);
  const accounts = await db.query(`
    SELECT a.*, p.profile_path, p.status AS profile_status,
      active_task.store_id AS active_store_id,
      active_task.store_name AS active_store_name,
      active_task.category_name AS active_category_name,
      collection.last_collected_at,
      collection.last_store_id,
      collection.last_store_name
    FROM accounts a
    LEFT JOIN profiles p ON p.profile_id = a.profile_id
    LEFT JOIN LATERAL (
      SELECT t.store_id, s.name AS store_name, t.category_name
      FROM category_tasks t
      JOIN stores s ON s.store_id = t.store_id
      WHERE t.assigned_account_id = a.account_id
        AND t.status IN ('assigned','running','collecting','captured','uploading','structuring','validating')
      ORDER BY COALESCE(t.last_progress_at, t.updated_at) DESC
      LIMIT 1
    ) active_task ON true
    LEFT JOIN LATERAL (
      SELECT
        t.last_progress_at AS last_collected_at,
        t.store_id AS last_store_id,
        s.name AS last_store_name
      FROM category_tasks t
      JOIN stores s ON s.store_id = t.store_id
      WHERE t.assigned_account_id = a.account_id
        AND t.collected_items > 0
        AND t.last_progress_at IS NOT NULL
      ORDER BY t.last_progress_at DESC
      LIMIT 1
    ) collection ON true
    ORDER BY a.account_id ASC
  `);

  const accountsByWorker = new Map<string, AccountSnapshot[]>();
  for (const row of accounts.rows) {
    const item: AccountSnapshot = {
      accountId: row.account_id,
      displayName: row.display_name,
      maskedLogin: row.masked_login || undefined,
      status: row.status,
      riskLevel: row.risk_level,
      profileId: row.profile_id,
      profileStatus: row.profile_status || "safe",
      profilePath: row.profile_path || "",
      cdpPort: row.cdp_port,
      cdpEndpoint: row.cdp_endpoint || undefined,
      currentStoreId: row.active_store_id || row.current_store_id || row.last_store_id || undefined,
      currentStoreName: row.active_store_name || row.last_store_name || row.current_store_name || undefined,
      currentCategoryName: row.active_category_name || undefined,
      lastCollectedAt: row.last_collected_at?.toISOString(),
      lastVerifiedAt: row.last_verified_at?.toISOString(),
      lastRiskAt: row.last_risk_at?.toISOString()
    };
    const list = accountsByWorker.get(row.worker_id) || [];
    list.push(item);
    accountsByWorker.set(row.worker_id, list);
  }
  const cdpEndpoints = await listCdpEndpoints(db);
  const cdpByWorker = new Map<string, typeof cdpEndpoints>();
  for (const endpoint of cdpEndpoints) {
    const list = cdpByWorker.get(endpoint.workerId) || [];
    list.push(endpoint);
    cdpByWorker.set(endpoint.workerId, list);
  }

  const now = new Date();
  return workers.rows.map((row) => ({
    worker: {
      workerId: row.worker_id,
      machineLabel: row.machine_label,
      hostname: row.hostname,
      os: row.os,
      agentVersion: row.agent_version,
      status: deriveVisibleWorkerStatus(row.status, row.last_seen_at, now),
      networkMode: row.network_mode,
      codexOperator: row.codex_operator,
      capabilities: row.capabilities || [],
      bootId: row.boot_id || undefined,
      startedAt: row.started_at?.toISOString(),
      currentIp: row.current_ip || undefined,
      diskFreeBytes: row.disk_free_bytes === null ? undefined : Number(row.disk_free_bytes),
      clockOffsetMs: row.clock_offset_ms ?? undefined,
      remoteDesktop: row.remote_desktop || undefined,
      lastSeenAt: row.last_seen_at.toISOString(),
      latestLogSummary: row.latest_log_summary || undefined
    },
    accounts: accountsByWorker.get(row.worker_id) || [],
    cdpEndpoints: cdpByWorker.get(row.worker_id) || [],
    execution: normalizeWorkerExecutionSnapshot(row.execution_snapshot)
  }));
}

export function normalizeWorkerExecutionSnapshot(value: unknown): WorkerStatusRow["execution"] {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as WorkerStatusRow["execution"];
  if (!snapshot?.capture || !snapshot.productPipeline || !snapshot.pressure) return undefined;
  if (!Number.isFinite(snapshot.capture.active) || !Number.isFinite(snapshot.capture.waiting)) return undefined;
  if (!Number.isFinite(snapshot.productPipeline.active) || !Number.isFinite(snapshot.productPipeline.waiting)) return undefined;
  if (!(["L0", "L1", "L2", "L3"] as string[]).includes(snapshot.pressure.level)) return undefined;
  return snapshot;
}

export async function getWorker(db: Pool, workerId: string): Promise<WorkerStatusRow | null> {
  const rows = await listWorkers(db);
  return rows.find((row) => row.worker.workerId === workerId) || null;
}

export function deriveVisibleWorkerStatus(
  storedStatus: WorkerStatus,
  lastSeenAt: string | Date,
  now = new Date(),
  staleAfterMs = 90_000
): WorkerStatus {
  const lastSeen = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  if (!Number.isFinite(lastSeen.getTime())) return "offline";
  return now.getTime() - lastSeen.getTime() > staleAfterMs ? "offline" : storedStatus;
}
