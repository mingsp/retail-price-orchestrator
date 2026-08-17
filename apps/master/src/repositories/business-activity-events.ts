import type { CategoryTaskRecord } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function recordTaskBusinessActivity(db: Pool, task: CategoryTaskRecord): Promise<void> {
  await db.query(
    `
    INSERT INTO business_activity_events (
      run_id, task_id, store_id, category_name, status, collected_items, occurred_at
    ) VALUES ($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (task_id, status, collected_items) DO NOTHING
    `,
    [task.runId, task.taskId, task.storeId, task.categoryName, task.status, task.collectedItems]
  );
}
