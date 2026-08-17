import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutionPoolConfig } from "../src/config.js";

test("execution pool config derives a bounded capture capacity from account slots", () => {
  assert.deepEqual(resolveExecutionPoolConfig({}, 6), {
    captureConcurrency: 4,
    captureQueueMax: 6,
    productPipelineConcurrency: 1,
    productPipelineQueueMax: 8,
    memoryShrinkRatio: 0.96,
    memoryStopRatio: 0.99,
    eventLoopStopMs: 100
  });
});

test("execution pool config accepts explicit production limits", () => {
  const config = resolveExecutionPoolConfig({
    WORKER_CAPTURE_CONCURRENCY: "3",
    WORKER_CAPTURE_QUEUE_MAX: "4",
    WORKER_PRODUCT_PIPELINE_CONCURRENCY: "2",
    WORKER_PRODUCT_PIPELINE_QUEUE_MAX: "10",
    WORKER_MEMORY_SHRINK_RATIO: "0.7",
    WORKER_MEMORY_STOP_RATIO: "0.9",
    WORKER_EVENT_LOOP_STOP_MS: "150"
  }, 4);
  assert.equal(config.captureConcurrency, 3);
  assert.equal(config.productPipelineConcurrency, 2);
  assert.equal(config.memoryStopRatio, 0.9);
});

test("execution pool config rejects invalid or reversed limits", () => {
  assert.throws(() => resolveExecutionPoolConfig({ WORKER_CAPTURE_CONCURRENCY: "0" }), /worker_capture_concurrency_invalid/);
  assert.throws(() => resolveExecutionPoolConfig({ WORKER_PRODUCT_PIPELINE_CONCURRENCY: "1.5" }), /worker_product_pipeline_concurrency_invalid/);
  assert.throws(() => resolveExecutionPoolConfig({
    WORKER_MEMORY_SHRINK_RATIO: "0.9",
    WORKER_MEMORY_STOP_RATIO: "0.8"
  }), /worker_memory_threshold_order_invalid/);
});
