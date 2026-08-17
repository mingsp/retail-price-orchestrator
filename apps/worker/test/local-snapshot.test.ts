import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionSummary } from "../src/local-snapshot.js";

test("heartbeat execution summary uses concise business language", () => {
  const summary = buildExecutionSummary({
    capture: { name: "capture", concurrency: 4, maxQueueSize: 4, active: 2, waiting: 1, rejected: 0, completed: 0, failed: 0, queueWaitMsP95: 0 },
    productPipeline: { name: "product_pipeline", concurrency: 1, maxQueueSize: 8, active: 1, waiting: 0, rejected: 0, completed: 0, failed: 0, queueWaitMsP95: 0 },
    pressure: { level: "L1", memoryUsedRatio: 0.8, eventLoopDelayMsP95: 20, acceptingNewCapture: true },
    observedAt: "2026-07-21T00:00:00.000Z"
  });
  assert.equal(summary, "正在采集 2 项，等待 1 项，数据处理中 1 项，系统已自动降速");
  assert.equal(buildExecutionSummary(undefined), "设备状态待同步");
});
