import type { Pool } from "pg";

export function isLeaseGuardValid(
  currentOwner: string | undefined,
  currentGeneration: number,
  expectedOwner: string | undefined,
  expectedGeneration: number | undefined
): boolean {
  return Boolean(
    currentOwner &&
    expectedOwner &&
    currentOwner === expectedOwner &&
    expectedGeneration !== undefined &&
    currentGeneration === expectedGeneration
  );
}

export async function renewTaskLease(
  db: Pool,
  taskId: string,
  leaseOwner: string,
  leaseGeneration: number,
  seconds = 120
): Promise<boolean> {
  const result = await db.query(
    `
    UPDATE category_tasks
    SET lease_until = now() + ($4 || ' seconds')::interval,
        updated_at = now()
    WHERE task_id = $1
      AND lease_owner = $2
      AND lease_generation = $3
      AND lease_until > now()
    `,
    [taskId, leaseOwner, leaseGeneration, seconds]
  );
  return result.rowCount === 1;
}

export async function requeueExpiredLeases(db: Pool): Promise<number> {
  const leaseResult = await db.query(`
    UPDATE category_tasks
    SET status = 'pending',
        lease_owner = NULL,
        lease_until = NULL,
        updated_at = now(),
        last_error = 'lease expired; requeued by master'
    WHERE status IN ('assigned', 'running', 'collecting', 'captured', 'uploading', 'structuring', 'validating')
      AND lease_until IS NOT NULL
      AND lease_until < now()
    RETURNING task_id
  `);
  const sleepResult = await db.query(`
    UPDATE category_tasks
    SET status = 'pending',
        lease_owner = NULL,
        lease_until = NULL,
        updated_at = now(),
        last_error = NULL,
        cursor = cursor || jsonb_build_object('sleepAutoRequeuedAt', now())
    WHERE status = 'paused'
      AND cursor ? 'sleepUntil'
      AND (cursor->>'sleepUntil')::timestamptz <= now()
    RETURNING task_id
  `);
  return (leaseResult.rowCount || 0) + (sleepResult.rowCount || 0);
}
