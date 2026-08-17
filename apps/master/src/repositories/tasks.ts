import type {
  CategoryTaskRecord,
  CreateCategoryTaskInput,
  CreateRunInput,
  CreateStoreInput,
  StoreRecord,
  StoreRunRecord,
  TaskClaimInput,
  TaskClaimResult,
  UpdateCategoryTaskInput
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { aggregateStoreRun } from "./run-progress.js";
import { recordTaskBusinessActivity } from "./business-activity-events.js";

export async function upsertStore(db: Pool, input: CreateStoreInput): Promise<StoreRecord> {
  const result = await db.query(
    `
    INSERT INTO stores (
      store_id, name, platform, poi_id_str, url, city, address, status, collection_policy, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
    ON CONFLICT (store_id) DO UPDATE SET
      name = EXCLUDED.name,
      platform = EXCLUDED.platform,
      poi_id_str = COALESCE(EXCLUDED.poi_id_str, stores.poi_id_str),
      url = COALESCE(NULLIF(EXCLUDED.url, ''), stores.url),
      city = COALESCE(EXCLUDED.city, stores.city),
      address = COALESCE(EXCLUDED.address, stores.address),
      status = EXCLUDED.status,
      collection_policy = EXCLUDED.collection_policy,
      updated_at = now()
    RETURNING *
    `,
    [
      input.storeId,
      input.name,
      input.platform || "meituan_h5",
      input.poiIdStr || null,
      input.url,
      input.city || null,
      input.address || null,
      input.status || "active",
      JSON.stringify(input.collectionPolicy || {})
    ]
  );
  return mapStore(result.rows[0]);
}

export async function listStores(db: Pool): Promise<StoreRecord[]> {
  const result = await db.query(`SELECT * FROM stores ORDER BY updated_at DESC`);
  return result.rows.map(mapStore);
}

export async function createRun(db: Pool, input: CreateRunInput): Promise<StoreRunRecord> {
  const result = await db.query(
    `
    INSERT INTO store_runs (store_id, run_label, strategy, target_finish_at)
    VALUES ($1,$2,$3,$4)
    RETURNING *
    `,
    [input.storeId, input.runLabel, input.strategy || "category_split", input.targetFinishAt || null]
  );
  return getRun(db, result.rows[0].run_id) as Promise<StoreRunRecord>;
}

export async function listRuns(db: Pool): Promise<StoreRunRecord[]> {
  const result = await db.query(`
    SELECT r.*, s.name AS store_name
    FROM store_runs r
    JOIN stores s ON s.store_id = r.store_id
    ORDER BY r.created_at DESC
    LIMIT 200
  `);
  return result.rows.map(mapRun);
}

export async function getRun(db: Pool, runId: string): Promise<StoreRunRecord | null> {
  const result = await db.query(
    `
    SELECT r.*, s.name AS store_name
    FROM store_runs r
    JOIN stores s ON s.store_id = r.store_id
    WHERE r.run_id = $1
    `,
    [runId]
  );
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

export async function createCategoryTasks(
  db: Pool,
  runId: string,
  tasks: CreateCategoryTaskInput[]
): Promise<CategoryTaskRecord[]> {
  const run = await getRun(db, runId);
  if (!run) return [];

  const created: CategoryTaskRecord[] = [];
  for (const [index, task] of tasks.entries()) {
    const result = await db.query(
      `
      INSERT INTO category_tasks (
        run_id, store_id, category_name, category_order, priority, expected_items, cursor
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        runId,
        run.storeId,
        task.categoryName,
        task.categoryOrder ?? index,
        task.priority ?? 100,
        task.expectedItems ?? null,
        JSON.stringify(task.cursor || {})
      ]
    );
    created.push(await getTask(db, result.rows[0].task_id) as CategoryTaskRecord);
  }
  await aggregateStoreRun(db, runId);
  await Promise.all(created.map((task) => recordTaskBusinessActivity(db, task)));
  return created;
}

export async function listTasks(db: Pool, runId?: string): Promise<CategoryTaskRecord[]> {
  const result = await db.query(
    `
    SELECT t.*, s.name AS store_name
    FROM category_tasks t
    JOIN stores s ON s.store_id = t.store_id
    WHERE ($1::uuid IS NULL OR t.run_id = $1::uuid)
    ORDER BY t.priority ASC, t.category_order ASC, t.created_at ASC
    `,
    [runId || null]
  );
  return result.rows.map(mapTask);
}

export async function getTask(db: Pool, taskId: string): Promise<CategoryTaskRecord | null> {
  const result = await db.query(
    `
    SELECT t.*, s.name AS store_name
    FROM category_tasks t
    JOIN stores s ON s.store_id = t.store_id
    WHERE t.task_id = $1
    `,
    [taskId]
  );
  return result.rows[0] ? mapTask(result.rows[0]) : null;
}

export async function updateTask(
  db: Pool,
  taskId: string,
  update: UpdateCategoryTaskInput
): Promise<CategoryTaskRecord | null> {
  const result = await db.query(
    `
    UPDATE category_tasks SET
      status = COALESCE($2, status),
      assigned_worker_id = CASE WHEN $3::boolean THEN $4 ELSE assigned_worker_id END,
      assigned_account_id = CASE WHEN $5::boolean THEN $6 ELSE assigned_account_id END,
      assigned_profile_id = CASE WHEN $7::boolean THEN $8 ELSE assigned_profile_id END,
      assigned_cdp_endpoint_id = CASE WHEN $9::boolean THEN $10 ELSE assigned_cdp_endpoint_id END,
      lease_owner = CASE WHEN $11::boolean THEN $12 ELSE lease_owner END,
      lease_until = CASE WHEN $13::boolean THEN $14::timestamptz ELSE lease_until END,
      last_progress_at = CASE
        WHEN $15::boolean THEN $16::timestamptz
        WHEN $24::integer IS NOT NULL THEN now()
        ELSE last_progress_at
      END,
      missing_spu_count = COALESCE($17, missing_spu_count),
      checkpoint_artifact_id = CASE WHEN $18::boolean THEN $19::uuid ELSE checkpoint_artifact_id END,
      raw_artifact_id = CASE WHEN $20::boolean THEN $21::uuid ELSE raw_artifact_id END,
      summary_artifact_id = CASE WHEN $22::boolean THEN $23::uuid ELSE summary_artifact_id END,
      collected_items = COALESCE($24, collected_items),
      cursor = COALESCE($25, cursor),
      last_error = CASE WHEN $26::boolean THEN $27 ELSE last_error END,
      updated_at = now()
    WHERE task_id = $1
      AND ($28::text IS NULL OR lease_owner = $28)
      AND ($29::integer IS NULL OR lease_generation = $29)
      AND (
        ($28::text IS NULL AND $29::integer IS NULL)
        OR lease_until > now()
      )
    RETURNING task_id
    `,
    [
      taskId,
      update.status || null,
      "assignedWorkerId" in update,
      update.assignedWorkerId || null,
      "assignedAccountId" in update,
      update.assignedAccountId || null,
      "assignedProfileId" in update,
      update.assignedProfileId || null,
      "assignedCdpEndpointId" in update,
      update.assignedCdpEndpointId || null,
      "leaseOwner" in update,
      update.leaseOwner || null,
      "leaseUntil" in update,
      update.leaseUntil || null,
      "lastProgressAt" in update,
      update.lastProgressAt || null,
      update.missingSpuCount ?? null,
      "checkpointArtifactId" in update,
      update.checkpointArtifactId || null,
      "rawArtifactId" in update,
      update.rawArtifactId || null,
      "summaryArtifactId" in update,
      update.summaryArtifactId || null,
      update.collectedItems ?? null,
      update.cursor ? JSON.stringify(update.cursor) : null,
      "lastError" in update,
      update.lastError || null,
      update.expectedLeaseOwner || null,
      update.expectedLeaseGeneration ?? null
    ]
  );
  if (!result.rows[0]) return null;
  const task = await getTask(db, taskId);
  if (task) {
    await aggregateStoreRun(db, task.runId);
    await recordTaskBusinessActivity(db, task);
  }
  return task;
}

export async function updateTaskWithRevokedLease(
  db: Pool,
  taskId: string,
  buildUpdate: UpdateCategoryTaskInput | ((task: CategoryTaskRecord) => UpdateCategoryTaskInput)
): Promise<CategoryTaskRecord | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT t.*, s.name AS store_name
       FROM category_tasks t JOIN stores s ON s.store_id = t.store_id
       WHERE t.task_id = $1 FOR UPDATE OF t`,
      [taskId]
    );
    if (!locked.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `UPDATE category_tasks
       SET lease_owner = NULL, lease_until = NULL,
           lease_generation = lease_generation + 1, updated_at = now()
       WHERE task_id = $1`,
      [taskId]
    );
    const current = mapTask(locked.rows[0]);
    const update = typeof buildUpdate === "function" ? buildUpdate(current) : buildUpdate;
    const task = await updateTask(client as unknown as Pool, taskId, update);
    await client.query("COMMIT");
    return task;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function claimNextTask(db: Pool, input: TaskClaimInput): Promise<TaskClaimResult> {
  const account = await db.query(
    `
    SELECT
      a.status AS account_status,
      a.risk_level,
      p.status AS profile_status,
      c.status AS cdp_status,
      b.target_store_id,
      s.name AS target_store_name,
      s.poi_id_str AS target_poi_id_str,
      s.collection_policy AS target_collection_policy
    FROM accounts a
    JOIN profiles p ON p.profile_id = a.profile_id
    LEFT JOIN cdp_endpoints c ON c.endpoint_id = $4 AND c.worker_id = $2
    LEFT JOIN browser_slots b ON b.slot_id = c.slot_id
      AND b.worker_id = $2
      AND b.account_id = $1
      AND b.profile_id = $3
      AND b.status <> 'retired'
    LEFT JOIN stores s ON s.store_id = b.target_store_id
    WHERE a.account_id = $1
      AND a.worker_id = $2
      AND a.profile_id = $3
      AND ($4::text IS NULL OR b.slot_id IS NOT NULL)
    `,
    [input.accountId, input.workerId, input.profileId, input.cdpEndpointId || null]
  );

  if (!account.rows[0] || !["safe", "running"].includes(account.rows[0].account_status)) {
    return { reason: "account_not_eligible" };
  }
  if (account.rows[0].risk_level === "blocked" || account.rows[0].risk_level === "high") {
    return { reason: "account_not_eligible" };
  }
  if (account.rows[0].profile_status !== "safe") {
    return { reason: "profile_not_eligible" };
  }
  if (!input.cdpEndpointId || !account.rows[0].cdp_status || !["ready", "running"].includes(account.rows[0].cdp_status)) {
    return { reason: "cdp_not_eligible" };
  }
  if (input.observedPageState !== "ready") return { reason: "page_not_ready" };
  if (!matchesObservedStore(
    account.rows[0].target_poi_id_str,
    account.rows[0].target_store_name,
    input.observedPoiIdStr,
    input.observedStoreName
  )) return { reason: "store_mismatch" };
  if (!matchesObservedLocation(
    account.rows[0].target_collection_policy,
    input.observedActualLat,
    input.observedActualLng
  )) return { reason: "location_not_confirmed" };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      [input.workerId, input.accountId, input.profileId, input.cdpEndpointId || ""].join("|")
    ]);
    const activeForIdentity = await client.query(
      `
      SELECT task_id
      FROM category_tasks
      WHERE status IN ('assigned', 'running', 'collecting', 'captured', 'uploading', 'structuring', 'validating')
        AND (
          assigned_account_id = $1
          OR assigned_profile_id = $2
          OR ($3::text IS NOT NULL AND assigned_cdp_endpoint_id = $3)
        )
      LIMIT 1
      `,
      [input.accountId, input.profileId, input.cdpEndpointId || null]
    );
    if (activeForIdentity.rows[0]) {
      await client.query("COMMIT");
      return { reason: "no_task" };
    }
    const selected = await client.query(
      `
      SELECT t.task_id
      FROM category_tasks t
      JOIN cdp_endpoints c ON c.endpoint_id = $4
      JOIN browser_slots b ON b.slot_id = c.slot_id
      WHERE t.status = 'pending'
        AND t.assigned_worker_id = $1
        AND t.assigned_account_id = $2
        AND t.assigned_profile_id = $3
        AND t.assigned_cdp_endpoint_id = $4
        AND c.worker_id = $1
        AND b.worker_id = $1
        AND b.account_id = $2
        AND b.profile_id = $3
        AND b.target_store_id = t.store_id
        AND b.status <> 'retired'
      ORDER BY t.priority ASC, t.category_order ASC, t.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
      `,
      [input.workerId, input.accountId, input.profileId, input.cdpEndpointId || null]
    );

    if (!selected.rows[0]) {
      await client.query("COMMIT");
      return { reason: "no_task" };
    }

    const updated = await client.query(
      `
      UPDATE category_tasks SET
        status = 'assigned',
        assigned_worker_id = $2,
        assigned_account_id = $3,
        assigned_profile_id = $4,
        assigned_cdp_endpoint_id = COALESCE($5, assigned_cdp_endpoint_id),
        lease_owner = $2,
        lease_until = now() + interval '10 minutes',
        lease_generation = lease_generation + 1,
        updated_at = now()
      WHERE task_id = $1
      RETURNING task_id
      `,
      [selected.rows[0].task_id, input.workerId, input.accountId, input.profileId, input.cdpEndpointId || null]
    );
    await client.query("COMMIT");
    const task = await getTask(db, updated.rows[0].task_id);
    if (task) {
      await aggregateStoreRun(db, task.runId);
      await recordTaskBusinessActivity(db, task);
    }
    return task ? { task } : { reason: "no_task" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markNextPreflightTaskManualRequired(
  db: Pool,
  input: TaskClaimInput,
  reason: "store_mismatch" | "location_not_confirmed" | "page_not_ready"
): Promise<CategoryTaskRecord | null> {
  const result = await db.query(`
    WITH candidate AS (
      SELECT task_id
      FROM category_tasks
      WHERE status IN ('pending', 'assigned')
        AND assigned_worker_id = $1
        AND assigned_account_id = $2
        AND assigned_profile_id = $3
        AND assigned_cdp_endpoint_id = $4
      ORDER BY priority, category_order, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE category_tasks t SET
      status = 'manual_required',
      lease_owner = NULL,
      lease_until = NULL,
      last_error = $5,
      cursor = cursor || jsonb_build_object(
        'preflightBlockedAt', now(),
        'preflightBlockedReason', $5::text
      ),
      updated_at = now()
    FROM candidate
    WHERE t.task_id = candidate.task_id
    RETURNING t.task_id
  `, [input.workerId, input.accountId, input.profileId, input.cdpEndpointId || null, reason]);
  return result.rows[0] ? getTask(db, result.rows[0].task_id) : null;
}

export function matchesObservedStore(
  expectedPoiIdStr: string | undefined,
  expectedStoreName: string | undefined,
  observedPoiIdStr: string | undefined,
  observedStoreName: string | undefined
): boolean {
  if (expectedPoiIdStr) return expectedPoiIdStr === observedPoiIdStr;
  if (!expectedStoreName || !observedStoreName) return false;
  const normalize = (value: string) => value.replace(/[\s（）()·_-]/g, "").toLowerCase();
  return normalize(observedStoreName).includes(normalize(expectedStoreName));
}

export function matchesObservedLocation(
  collectionPolicy: Record<string, unknown> | undefined,
  observedLatitude: number | undefined,
  observedLongitude: number | undefined
): boolean {
  const rule = collectionPolicy?.locationPreflight;
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return true;
  const policy = rule as Record<string, unknown>;
  if (policy.required !== true) return true;
  const latitude = Number(policy.latitude);
  const longitude = Number(policy.longitude);
  const observedLat = Number(observedLatitude);
  const observedLng = Number(observedLongitude);
  const configuredRadius = Number(policy.maxDistanceMeters);
  const maxDistanceMeters = Number.isFinite(configuredRadius)
    ? Math.min(50_000, Math.max(100, configuredRadius))
    : 5_000;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(observedLat) ||
    !Number.isFinite(observedLng)
  ) return false;
  return distanceMeters(latitude, longitude, observedLat, observedLng) <= maxDistanceMeters;
}

function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapStore(row: any): StoreRecord {
  return {
    storeId: row.store_id,
    name: row.name,
    platform: row.platform,
    poiIdStr: row.poi_id_str || undefined,
    url: row.url,
    city: row.city || undefined,
    address: row.address || undefined,
    status: row.status,
    collectionPolicy: row.collection_policy || {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapRun(row: any): StoreRunRecord {
  return {
    runId: row.run_id,
    storeId: row.store_id,
    storeName: row.store_name || undefined,
    runLabel: row.run_label,
    status: row.status,
    strategy: row.strategy,
    targetFinishAt: row.target_finish_at?.toISOString(),
    startedAt: row.started_at?.toISOString(),
    completedAt: row.completed_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapTask(row: any): CategoryTaskRecord {
  return {
    taskId: row.task_id,
    runId: row.run_id,
    storeId: row.store_id,
    storeName: row.store_name || undefined,
    categoryName: row.category_name,
    categoryOrder: row.category_order,
    status: row.status,
    priority: row.priority,
    assignedWorkerId: row.assigned_worker_id || undefined,
    assignedAccountId: row.assigned_account_id || undefined,
    assignedProfileId: row.assigned_profile_id || undefined,
    assignedCdpEndpointId: row.assigned_cdp_endpoint_id || undefined,
    leaseOwner: row.lease_owner || undefined,
    leaseUntil: row.lease_until?.toISOString(),
    leaseGeneration: Number(row.lease_generation || 0),
    lastProgressAt: row.last_progress_at?.toISOString(),
    missingSpuCount: row.missing_spu_count || 0,
    checkpointArtifactId: row.checkpoint_artifact_id || undefined,
    rawArtifactId: row.raw_artifact_id || undefined,
    summaryArtifactId: row.summary_artifact_id || undefined,
    expectedItems: row.expected_items ?? undefined,
    collectedItems: row.collected_items,
    cursor: row.cursor || {},
    lastError: row.last_error || undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
