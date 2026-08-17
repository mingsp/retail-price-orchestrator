import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveVisibleWorkerStatus,
  normalizeWorkerExecutionSnapshot,
  pruneWorkerHeartbeats,
  shouldPruneMissingHeartbeatResources
} from "../src/repositories/workers.js";
import type { Pool } from "pg";

test("deriveVisibleWorkerStatus marks stale workers offline", () => {
  const now = new Date("2026-07-09T10:00:00.000Z");

  assert.equal(deriveVisibleWorkerStatus("online", "2026-07-09T09:59:30.000Z", now), "online");
  assert.equal(deriveVisibleWorkerStatus("online", "2026-07-09T09:55:00.000Z", now), "offline");
  assert.equal(deriveVisibleWorkerStatus("device_risk", "2026-07-09T09:55:00.000Z", now), "offline");
});

test("partial or empty heartbeats never prune registered resources", () => {
  assert.equal(shouldPruneMissingHeartbeatResources(undefined), false);
  assert.equal(shouldPruneMissingHeartbeatResources("incremental"), false);
});

test("heartbeat retention removes only history older than the configured window", async () => {
  let sql = "";
  let params: unknown[] = [];
  const db = {
    async query(query: string, values: unknown[]) {
      sql = query;
      params = values;
      return { rowCount: 12 };
    }
  } as unknown as Pool;

  assert.equal(await pruneWorkerHeartbeats(db, 14), 12);
  assert.match(sql, /DELETE FROM worker_heartbeats/);
  assert.match(sql, /received_at < now\(\)/);
  assert.deepEqual(params, [14]);
});

test("worker execution capacity is returned only when the heartbeat snapshot is complete", () => {
  const snapshot = {
    capture: { name: "capture", concurrency: 4, maxQueueSize: 4, active: 2, waiting: 1, rejected: 0, completed: 3, failed: 0, queueWaitMsP95: 12 },
    productPipeline: { name: "product_pipeline", concurrency: 1, maxQueueSize: 8, active: 1, waiting: 0, rejected: 0, completed: 2, failed: 0, queueWaitMsP95: 0 },
    pressure: { level: "L0", memoryUsedRatio: 0.5, eventLoopDelayMsP95: 5, acceptingNewCapture: true },
    observedAt: "2026-07-21T00:00:00.000Z"
  } as const;
  assert.deepEqual(normalizeWorkerExecutionSnapshot(snapshot), snapshot);
  assert.equal(normalizeWorkerExecutionSnapshot({ capture: snapshot.capture }), undefined);
  assert.equal(normalizeWorkerExecutionSnapshot({ ...snapshot, pressure: { ...snapshot.pressure, level: "L9" } }), undefined);
});
