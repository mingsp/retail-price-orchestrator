import type { WorkerConfig } from "./config.js";
import { BoundedExecutionPool, type PoolSnapshot } from "./bounded-execution-pool.js";
import { ResourcePressureMonitor, type ResourcePressureSnapshot } from "./resource-pressure.js";

export interface WorkerExecutionSnapshot {
  capture: PoolSnapshot;
  productPipeline: PoolSnapshot;
  pressure: ResourcePressureSnapshot;
  observedAt: string;
}

export interface ExecutionRuntime {
  capturePool: BoundedExecutionPool;
  productPipelinePool: BoundedExecutionPool;
  resourcePressure: ResourcePressureMonitor;
  snapshot(): WorkerExecutionSnapshot;
  close(): void;
}

let activeRuntime: ExecutionRuntime | undefined;

export function initializeExecutionRuntime(config: WorkerConfig): ExecutionRuntime {
  if (activeRuntime) return activeRuntime;
  activeRuntime = createExecutionRuntime(config);
  return activeRuntime;
}

export function createExecutionRuntime(
  config: Pick<
    WorkerConfig,
    | "captureConcurrency"
    | "captureQueueMax"
    | "productPipelineConcurrency"
    | "productPipelineQueueMax"
    | "memoryShrinkRatio"
    | "memoryStopRatio"
    | "eventLoopStopMs"
  >,
  resourcePressure = new ResourcePressureMonitor(config)
): ExecutionRuntime {
  const capturePool = new BoundedExecutionPool({
    name: "capture",
    concurrency: config.captureConcurrency,
    maxQueueSize: config.captureQueueMax
  });
  const productPipelinePool = new BoundedExecutionPool({
    name: "product_pipeline",
    concurrency: config.productPipelineConcurrency,
    maxQueueSize: config.productPipelineQueueMax
  });
  return {
    capturePool,
    productPipelinePool,
    resourcePressure,
    snapshot() {
      const pressure = resourcePressure.snapshot();
      capturePool.setConcurrency(
        pressure.level === "L1" ? Math.max(1, Math.floor(config.captureConcurrency / 2)) : config.captureConcurrency
      );
      return {
        capture: capturePool.snapshot(),
        productPipeline: productPipelinePool.snapshot(),
        pressure,
        observedAt: new Date().toISOString()
      };
    },
    close() {
      resourcePressure.close();
    }
  };
}

export function getExecutionRuntime(): ExecutionRuntime {
  if (!activeRuntime) throw new Error("execution_runtime_not_initialized");
  return activeRuntime;
}

export function resetExecutionRuntimeForTest(): void {
  activeRuntime?.close();
  activeRuntime = undefined;
}
