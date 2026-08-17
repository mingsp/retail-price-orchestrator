import assert from "node:assert/strict";
import test from "node:test";
import { BoundedExecutionPool } from "../src/bounded-execution-pool.js";

test("product pipeline applies backpressure and cancels waiting work on lease loss", async () => {
  const pool = new BoundedExecutionPool({ name: "product_pipeline", concurrency: 1, maxQueueSize: 2 });
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const active = pool.run({ key: "task-a" }, () => blocker);
  const controller = new AbortController();
  const waiting = pool.run({ key: "task-b", signal: controller.signal }, async () => undefined);
  controller.abort(new Error("lease_lost"));
  await assert.rejects(waiting, /lease_lost/);
  assert.equal(pool.snapshot().waiting, 0);
  release();
  await active;
});
