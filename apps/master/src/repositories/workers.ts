import type { AccountSnapshot, WorkerHeartbeatPayload, WorkerStatusRow } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function upsertWorkerSnapshot(db: Pool, payload: WorkerHeartbeatPayload): Promise<void> {
  const { worker, accounts } = payload;
  await db.query(
    `
    INSERT INTO workers (
      worker_id, machine_label, hostname, os, agent_version, status,
      network_mode, codex_operator, capabilities, latest_log_summary,
      last_seen_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
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
      payload.latestLogSummary || null
    ]
  );

  await db.query(
    `INSERT INTO worker_heartbeats (worker_id, sent_at, payload) VALUES ($1, $2, $3)`,
    [worker.workerId, payload.sentAt, JSON.stringify(payload)]
  );

  for (const account of accounts) {
    await upsertAccount(db, worker.workerId, account);
  }
}

async function upsertAccount(db: Pool, workerId: string, account: AccountSnapshot): Promise<void> {
  await db.query(
    `
    INSERT INTO accounts (
      account_id, worker_id, display_name, masked_login, status, risk_level,
      profile_id, cdp_port, current_store_id, current_store_name,
      current_category_name, last_verified_at, last_risk_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
    ON CONFLICT (account_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      display_name = EXCLUDED.display_name,
      masked_login = EXCLUDED.masked_login,
      status = EXCLUDED.status,
      risk_level = EXCLUDED.risk_level,
      profile_id = EXCLUDED.profile_id,
      cdp_port = EXCLUDED.cdp_port,
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
      profile_id, worker_id, account_id, profile_path, cdp_port, status,
      last_risk_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,now())
    ON CONFLICT (profile_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      account_id = EXCLUDED.account_id,
      profile_path = EXCLUDED.profile_path,
      cdp_port = EXCLUDED.cdp_port,
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
      account.profileStatus,
      account.lastRiskAt || null
    ]
  );
}

export async function listWorkers(db: Pool): Promise<WorkerStatusRow[]> {
  const workers = await db.query(`
    SELECT * FROM workers ORDER BY worker_id ASC
  `);
  const accounts = await db.query(`
    SELECT a.*, p.profile_path, p.status AS profile_status
    FROM accounts a
    LEFT JOIN profiles p ON p.profile_id = a.profile_id
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
      currentStoreId: row.current_store_id || undefined,
      currentStoreName: row.current_store_name || undefined,
      currentCategoryName: row.current_category_name || undefined,
      lastVerifiedAt: row.last_verified_at?.toISOString(),
      lastRiskAt: row.last_risk_at?.toISOString()
    };
    const list = accountsByWorker.get(row.worker_id) || [];
    list.push(item);
    accountsByWorker.set(row.worker_id, list);
  }

  return workers.rows.map((row) => ({
    worker: {
      workerId: row.worker_id,
      machineLabel: row.machine_label,
      hostname: row.hostname,
      os: row.os,
      agentVersion: row.agent_version,
      status: row.status,
      networkMode: row.network_mode,
      codexOperator: row.codex_operator,
      capabilities: row.capabilities || [],
      lastSeenAt: row.last_seen_at.toISOString(),
      latestLogSummary: row.latest_log_summary || undefined
    },
    accounts: accountsByWorker.get(row.worker_id) || []
  }));
}

export async function getWorker(db: Pool, workerId: string): Promise<WorkerStatusRow | null> {
  const rows = await listWorkers(db);
  return rows.find((row) => row.worker.workerId === workerId) || null;
}

