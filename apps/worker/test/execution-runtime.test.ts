import assert from "node:assert/strict";
import test from "node:test";
import { resolveExecutionPoolConfig } from "../src/config.js";
import { createExecutionRuntime } from "../src/execution-runtime.js";
import { ResourcePressureMonitor } from "../src/resource-pressure.js";

const config = {
  captureConcurrency: 4,
  captureQueueMax: 4,
  productPipelineConcurrency: 1,
  productPipelineQueueMax: 8,
  memoryShrinkRatio: 0.75,
  memoryStopRatio: 0.85,
  eventLoopStopMs: 100
};

test("runtime shrinks capture capacity under L1 memory pressure", () => {
  const pressure = new ResourcePressureMonitor(config, () => ({ memoryUsedRatio: 0.8, eventLoopDelayMsP95: 10 }));
  const runtime = createExecutionRuntime(config, pressure);
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.pressure.level, "L1");
  assert.equal(snapshot.capture.concurrency, 2);
  assert.equal(snapshot.pressure.acceptingNewCapture, true);
  runtime.close();
});

test("production defaults keep full capture capacity below 96 percent memory", () => {
  const defaultConfig = resolveExecutionPoolConfig({}, 4);
  const pressure = new ResourcePressureMonitor(defaultConfig, () => ({ memoryUsedRatio: 0.95, eventLoopDelayMsP95: 10 }));
  const runtime = createExecutionRuntime(defaultConfig, pressure);
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.pressure.level, "L0");
  assert.equal(snapshot.capture.concurrency, 4);
  assert.equal(snapshot.pressure.acceptingNewCapture, true);
  runtime.close();
});

test("runtime stops intake under L2 and explicit L3 pressure", () => {
  const pressure = new ResourcePressureMonitor(config, () => ({ memoryUsedRatio: 0.9, eventLoopDelayMsP95: 10 }));
  const runtime = createExecutionRuntime(config, pressure);
  assert.deepEqual(runtime.snapshot().pressure, {
    level: "L2",
    memoryUsedRatio: 0.9,
    eventLoopDelayMsP95: 10,
    acceptingNewCapture: false,
    reason: "memory_pressure"
  });
  pressure.halt("storage_unavailable");
  assert.equal(runtime.snapshot().pressure.level, "L3");
  pressure.clearHalt();
  assert.equal(runtime.snapshot().pressure.level, "L2");
  runtime.close();
});
