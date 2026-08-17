import type { IngestionErrorInput } from "@retail-orchestrator/shared";
import type { Pool } from "pg";

export async function registerIngestionError(db: Pool, input: IngestionErrorInput): Promise<void> {
  await db.query(
    `
    INSERT INTO ingestion_errors (
      error_key, artifact_id, run_id, task_id, store_id, line_number,
      error_code, error_message, raw_excerpt
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (error_key) DO UPDATE SET
      error_message = EXCLUDED.error_message,
      raw_excerpt = EXCLUDED.raw_excerpt
    `,
    [
      input.errorKey,
      input.artifactId || null,
      input.runId,
      input.taskId,
      input.storeId,
      input.lineNumber ?? null,
      input.errorCode,
      input.errorMessage,
      input.rawExcerpt || null
    ]
  );
}
