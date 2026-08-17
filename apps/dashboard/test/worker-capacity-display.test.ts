import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkerCapacity } from "../src/worker-status.js";

test("worker capacity display never fabricates missing capacity", () => {
  assert.deepEqual(formatWorkerCapacity(undefined), ["设备容量待同步"]);
});

test("worker capacity display translates runtime pressure into business language", () => {
  const lines = formatWorkerCapacity({
    capture: { name: "capture", concurrency: 4, maxQueueSize: 4, active: 2, waiting: 1, rejected: 0, completed: 0, failed: 0, queueWaitMsP95: 0 },
    productPipeline: { name: "product_pipeline", concurrency: 1, maxQueueSize: 8, active: 1, waiting: 0, rejected: 0, completed: 0, failed: 0, queueWaitMsP95: 0 },
    pressure: { level: "L1", memoryUsedRatio: 0.8, eventLoopDelayMsP95: 12, acceptingNewCapture: true },
    observedAt: "2026-07-21T00:00:00.000Z"
  });
  assert.deepEqual(lines, ["采集中 2/4", "等待处理 1", "数据处理中 1", "系统已自动降速"]);
  assert.equal(lines.some((line) => /thread|pool|queue|路径/i.test(line)), false);
});
