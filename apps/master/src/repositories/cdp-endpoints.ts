import type { CdpEndpointRecord, CdpEndpointSnapshot } from "@retail-orchestrator/shared";
import type { Pool, PoolClient } from "pg";

export async function upsertCdpEndpoints(
  db: Pool,
  workerId: string,
  endpoints: CdpEndpointSnapshot[]
): Promise<void> {
  for (const endpoint of endpoints) {
    await upsertCdpEndpoint(db, workerId, endpoint);
  }
}

export async function pruneStaleCdpEndpoints(
  db: Pool,
  workerId: string,
  endpoints: CdpEndpointSnapshot[]
): Promise<void> {
  const endpointIds = endpoints.map((endpoint) => endpoint.endpointId || `${workerId}:${endpoint.port}`);
  if (endpointIds.length) {
    await db.query(
      `DELETE FROM cdp_endpoints WHERE worker_id = $1 AND NOT (endpoint_id = ANY($2::text[]))`,
      [workerId, endpointIds]
    );
  } else {
    await db.query(`DELETE FROM cdp_endpoints WHERE worker_id = $1`, [workerId]);
  }
}

export async function upsertCdpEndpoint(
  db: Pool | PoolClient,
  workerId: string,
  endpoint: CdpEndpointSnapshot
): Promise<CdpEndpointRecord> {
  const host = endpoint.host || "127.0.0.1";
  const endpointId = endpoint.endpointId || `${workerId}:${endpoint.port}`;
  const endpointUrl = endpoint.endpointUrl || `http://${host}:${endpoint.port}`;
  let profileId = endpoint.profileId;
  let accountId = endpoint.accountId;
  let targetStoreId = endpoint.targetStoreId;
  let endpointStatus = endpoint.status;
  if (endpoint.slotId) {
    const slot = await db.query(`
      UPDATE browser_slots SET
        port = $3,
        status = CASE WHEN status = 'retired' THEN status ELSE $4 END,
        updated_at = now()
      WHERE slot_id = $1 AND worker_id = $2
      RETURNING slot_id, profile_id, account_id, target_store_id, status
    `, [endpoint.slotId, workerId, endpoint.port, endpoint.status]);
    if (!slot.rows[0]) throw new Error("slot_worker_mismatch");
    endpointStatus = resolveAuthoritativeSlotStatus(slot.rows[0].status, endpointStatus);
    profileId = resolveAuthoritativeBinding("profile", slot.rows[0].profile_id, endpoint.profileId);
    accountId = resolveAuthoritativeBinding("account", slot.rows[0].account_id, endpoint.accountId);
    targetStoreId = resolveAuthoritativeBinding("store", slot.rows[0].target_store_id, endpoint.targetStoreId);
  }
  const result = await db.query(
    `
    INSERT INTO cdp_endpoints (
      endpoint_id, slot_id, worker_id, host, port, endpoint_url, ws_endpoint, status,
      profile_id, account_id, account_display_name, masked_login, operator_owner,
      target_store_id, target_store_name, current_category_name, last_seen_url,
      last_seen_title, last_screenshot_artifact_id, manual_note, last_seen_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now(),now())
    ON CONFLICT (endpoint_id) DO UPDATE SET
      worker_id = EXCLUDED.worker_id,
      slot_id = COALESCE(EXCLUDED.slot_id, cdp_endpoints.slot_id),
      host = EXCLUDED.host,
      port = EXCLUDED.port,
      endpoint_url = EXCLUDED.endpoint_url,
      ws_endpoint = COALESCE(EXCLUDED.ws_endpoint, cdp_endpoints.ws_endpoint),
      status = EXCLUDED.status,
      profile_id = COALESCE(EXCLUDED.profile_id, cdp_endpoints.profile_id),
      account_id = COALESCE(EXCLUDED.account_id, cdp_endpoints.account_id),
      account_display_name = COALESCE(EXCLUDED.account_display_name, cdp_endpoints.account_display_name),
      masked_login = COALESCE(EXCLUDED.masked_login, cdp_endpoints.masked_login),
      operator_owner = COALESCE(EXCLUDED.operator_owner, cdp_endpoints.operator_owner),
      target_store_id = COALESCE(EXCLUDED.target_store_id, cdp_endpoints.target_store_id),
      target_store_name = COALESCE(EXCLUDED.target_store_name, cdp_endpoints.target_store_name),
      current_category_name = COALESCE(EXCLUDED.current_category_name, cdp_endpoints.current_category_name),
      last_seen_url = COALESCE(EXCLUDED.last_seen_url, cdp_endpoints.last_seen_url),
      last_seen_title = COALESCE(EXCLUDED.last_seen_title, cdp_endpoints.last_seen_title),
      last_screenshot_artifact_id = COALESCE(EXCLUDED.last_screenshot_artifact_id, cdp_endpoints.last_screenshot_artifact_id),
      manual_note = COALESCE(EXCLUDED.manual_note, cdp_endpoints.manual_note),
      last_seen_at = now(),
      updated_at = now()
    RETURNING *
    `,
    [
      endpointId,
      endpoint.slotId || null,
      workerId,
      host,
      endpoint.port,
      endpointUrl,
      endpoint.wsEndpoint || null,
      endpointStatus,
      profileId || null,
      accountId || null,
      endpoint.accountDisplayName || null,
      endpoint.maskedLogin || null,
      endpoint.operatorOwner || null,
      targetStoreId || null,
      endpoint.targetStoreName || null,
      endpoint.currentCategoryName || null,
      endpoint.lastSeenUrl || null,
      endpoint.lastSeenTitle || null,
      endpoint.lastScreenshotArtifactId || null,
      endpoint.manualNote || null
    ]
  );
  return mapCdpEndpoint(result.rows[0]);
}

export function resolveAuthoritativeBinding(
  resource: "account" | "profile" | "store",
  slotValue?: string | null,
  reportedValue?: string
): string | undefined {
  if (slotValue && reportedValue && slotValue !== reportedValue) throw new Error(`slot_${resource}_mismatch`);
  return slotValue || reportedValue || undefined;
}

export function resolveAuthoritativeSlotStatus(
  currentStatus: CdpEndpointSnapshot["status"],
  reportedStatus: CdpEndpointSnapshot["status"]
): CdpEndpointSnapshot["status"] {
  return currentStatus === "retired" ? "retired" : reportedStatus;
}

export async function listCdpEndpoints(db: Pool, workerId?: string): Promise<CdpEndpointRecord[]> {
  const result = await db.query(
    `
    SELECT *
    FROM cdp_endpoints
    WHERE ($1::text IS NULL OR worker_id = $1)
    ORDER BY worker_id ASC, port ASC
    `,
    [workerId || null]
  );
  const now = new Date();
  return result.rows.map((row) => mapCdpEndpoint(row, now));
}

export async function getCdpEndpoint(db: Pool, endpointId: string): Promise<CdpEndpointRecord | null> {
  const result = await db.query(`SELECT * FROM cdp_endpoints WHERE endpoint_id = $1`, [endpointId]);
  return result.rows[0] ? mapCdpEndpoint(result.rows[0]) : null;
}

export function deriveVisibleCdpEndpointStatus(
  storedStatus: CdpEndpointSnapshot["status"],
  lastSeenAt: string | Date,
  now = new Date(),
  staleAfterMs = 90_000
): CdpEndpointSnapshot["status"] {
  if (["idle", "manual_required", "profile_risk", "retired"].includes(storedStatus)) return storedStatus;
  const lastSeen = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  if (!Number.isFinite(lastSeen.getTime())) return "unknown";
  return now.getTime() - lastSeen.getTime() > staleAfterMs ? "unknown" : storedStatus;
}

export async function updateCdpEndpoint(
  db: Pool,
  endpointId: string,
  update: Partial<CdpEndpointSnapshot>
): Promise<CdpEndpointRecord | null> {
  await db.query(
    `
    UPDATE cdp_endpoints SET
      status = COALESCE($2, status),
      profile_id = CASE WHEN $3::boolean THEN $4 ELSE profile_id END,
      account_id = CASE WHEN $5::boolean THEN $6 ELSE account_id END,
      account_display_name = CASE WHEN $7::boolean THEN $8 ELSE account_display_name END,
      masked_login = CASE WHEN $9::boolean THEN $10 ELSE masked_login END,
      operator_owner = CASE WHEN $11::boolean THEN $12 ELSE operator_owner END,
      target_store_id = CASE WHEN $13::boolean THEN $14 ELSE target_store_id END,
      target_store_name = CASE WHEN $15::boolean THEN $16 ELSE target_store_name END,
      current_category_name = CASE WHEN $17::boolean THEN $18 ELSE current_category_name END,
      last_seen_url = CASE WHEN $19::boolean THEN $20 ELSE last_seen_url END,
      last_seen_title = CASE WHEN $21::boolean THEN $22 ELSE last_seen_title END,
      manual_note = CASE WHEN $23::boolean THEN $24 ELSE manual_note END,
      updated_at = now()
    WHERE endpoint_id = $1
    `,
    [
      endpointId,
      update.status || null,
      "profileId" in update,
      update.profileId || null,
      "accountId" in update,
      update.accountId || null,
      "accountDisplayName" in update,
      update.accountDisplayName || null,
      "maskedLogin" in update,
      update.maskedLogin || null,
      "operatorOwner" in update,
      update.operatorOwner || null,
      "targetStoreId" in update,
      update.targetStoreId || null,
      "targetStoreName" in update,
      update.targetStoreName || null,
      "currentCategoryName" in update,
      update.currentCategoryName || null,
      "lastSeenUrl" in update,
      update.lastSeenUrl || null,
      "lastSeenTitle" in update,
      update.lastSeenTitle || null,
      "manualNote" in update,
      update.manualNote || null
    ]
  );
  return getCdpEndpoint(db, endpointId);
}

export function accountToCdpEndpoint(workerId: string, account: {
  cdpPort: number;
  cdpEndpoint?: string;
  profileId: string;
  accountId: string;
  displayName: string;
  maskedLogin?: string;
  currentStoreId?: string;
  currentStoreName?: string;
  currentCategoryName?: string;
  profileStatus?: string;
}): CdpEndpointSnapshot {
  let host = "127.0.0.1";
  try {
    if (account.cdpEndpoint) host = new URL(account.cdpEndpoint).hostname;
  } catch {
    host = "127.0.0.1";
  }
  return {
    endpointId: `${workerId}:${account.cdpPort}`,
    workerId,
    host,
    port: account.cdpPort,
    endpointUrl: account.cdpEndpoint || `http://${host}:${account.cdpPort}`,
    status: account.profileStatus === "profile_risk" ? "profile_risk" : "ready",
    profileId: account.profileId,
    accountId: account.accountId,
    accountDisplayName: account.displayName,
    maskedLogin: account.maskedLogin,
    targetStoreId: account.currentStoreId,
    targetStoreName: account.currentStoreName,
    currentCategoryName: account.currentCategoryName
  };
}

function mapCdpEndpoint(row: any, now = new Date()): CdpEndpointRecord {
  const lastSeenAt = row.last_seen_at?.toISOString();
  return {
    slotId: row.slot_id || undefined,
    endpointId: row.endpoint_id,
    workerId: row.worker_id,
    host: row.host,
    port: row.port,
    endpointUrl: row.endpoint_url,
    wsEndpoint: row.ws_endpoint || undefined,
    status: deriveVisibleCdpEndpointStatus(row.status, lastSeenAt || "invalid", now),
    profileId: row.profile_id || undefined,
    accountId: row.account_id || undefined,
    accountDisplayName: row.account_display_name || undefined,
    maskedLogin: row.masked_login || undefined,
    operatorOwner: row.operator_owner || undefined,
    targetStoreId: row.target_store_id || undefined,
    targetStoreName: row.target_store_name || undefined,
    currentCategoryName: row.current_category_name || undefined,
    lastSeenUrl: row.last_seen_url || undefined,
    lastSeenTitle: row.last_seen_title || undefined,
    lastScreenshotArtifactId: row.last_screenshot_artifact_id || undefined,
    manualNote: row.manual_note || undefined,
    lastSeenAt,
    updatedAt: row.updated_at.toISOString()
  };
}
