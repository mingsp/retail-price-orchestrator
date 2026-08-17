import assert from "node:assert/strict";
import test from "node:test";
import { registerIngestionError } from "../src/repositories/ingestion-errors.js";

test("ingestion error registration is idempotent by error key", async () => {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const db = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rows: [] }; } };
  await registerIngestionError(db as never, {
    errorKey: "task-1:capture-1:pipeline",
    runId: "run-1",
    taskId: "task-1",
    storeId: "store-1",
    errorCode: "raw_structured_mismatch",
    errorMessage: "raw_structured_mismatch:100:99"
  });
  assert.match(calls[0].sql, /ON CONFLICT \(error_key\)/);
  assert.equal(calls[0].params[0], "task-1:capture-1:pipeline");
});
