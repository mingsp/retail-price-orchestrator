import type {
  CategoryTaskRecord,
  CreateCategoryTaskInput,
  CreateRunInput,
  CreateStoreInput,
  StoreRecord,
  StoreRunRecord,
  UpdateCategoryTaskInput
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";

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
      poi_id_str = EXCLUDED.poi_id_str,
      url = EXCLUDED.url,
      city = EXCLUDED.city,
      address = EXCLUDED.address,
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
        run_id, store_id, category_name, category_order, priority, expected_items
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [
        runId,
        run.storeId,
        task.categoryName,
        task.categoryOrder ?? index,
        task.priority ?? 100,
        task.expectedItems ?? null
      ]
    );
    created.push(await getTask(db, result.rows[0].task_id) as CategoryTaskRecord);
  }
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
  await db.query(
    `
    UPDATE category_tasks SET
      status = COALESCE($2, status),
      assigned_worker_id = CASE WHEN $3::boolean THEN $4 ELSE assigned_worker_id END,
      assigned_account_id = CASE WHEN $5::boolean THEN $6 ELSE assigned_account_id END,
      assigned_profile_id = CASE WHEN $7::boolean THEN $8 ELSE assigned_profile_id END,
      collected_items = COALESCE($9, collected_items),
      cursor = COALESCE($10, cursor),
      last_error = CASE WHEN $11::boolean THEN $12 ELSE last_error END,
      updated_at = now()
    WHERE task_id = $1
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
      update.collectedItems ?? null,
      update.cursor ? JSON.stringify(update.cursor) : null,
      "lastError" in update,
      update.lastError || null
    ]
  );
  return getTask(db, taskId);
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
    expectedItems: row.expected_items ?? undefined,
    collectedItems: row.collected_items,
    cursor: row.cursor || {},
    lastError: row.last_error || undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
