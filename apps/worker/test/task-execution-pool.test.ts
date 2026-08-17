import assert from "node:assert/strict";
import test from "node:test";
import { BoundedExecutionPool } from "../src/bounded-execution-pool.js";

test("capture pool keeps one active operation per CDP key", async () => {
  const pool = new BoundedExecutionPool({ name: "capture", concurrency: 4, maxQueueSize: 4 });
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const running = pool.run({ key: "worker-a:9421" }, () => blocker);
  await assert.rejects(
    pool.run({ key: "worker-a:9421" }, async () => undefined),
    /pool_key_already_scheduled/
  );
  assert.equal(pool.snapshot().active, 1);
  release();
  await running;
});
