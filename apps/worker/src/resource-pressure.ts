import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";

export type ResourcePressureLevel = "L0" | "L1" | "L2" | "L3";

export interface ResourcePressureSnapshot {
  level: ResourcePressureLevel;
  memoryUsedRatio: number;
  eventLoopDelayMsP95: number;
  acceptingNewCapture: boolean;
  reason?: string;
}

interface PressureOptions {
  memoryShrinkRatio: number;
  memoryStopRatio: number;
  eventLoopStopMs: number;
}

interface PressureSample {
  memoryUsedRatio: number;
  eventLoopDelayMsP95: number;
}

export class ResourcePressureMonitor {
  private readonly histogram: ReturnType<typeof monitorEventLoopDelay> | undefined;
  private externalHaltReason?: string;

  constructor(
    private readonly options: PressureOptions,
    private readonly sampleProvider?: () => PressureSample
  ) {
    if (!sampleProvider) {
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    }
  }

  snapshot(): ResourcePressureSnapshot {
    const sample = this.sampleProvider ? this.sampleProvider() : this.readSystemSample();
    if (this.externalHaltReason) {
      return { ...sample, level: "L3", acceptingNewCapture: false, reason: this.externalHaltReason };
    }
    if (
      sample.memoryUsedRatio >= this.options.memoryStopRatio ||
      sample.eventLoopDelayMsP95 >= this.options.eventLoopStopMs
    ) {
      return {
        ...sample,
        level: "L2",
        acceptingNewCapture: false,
        reason: sample.memoryUsedRatio >= this.options.memoryStopRatio ? "memory_pressure" : "event_loop_pressure"
      };
    }
    if (sample.memoryUsedRatio >= this.options.memoryShrinkRatio) {
      return { ...sample, level: "L1", acceptingNewCapture: true, reason: "memory_pressure" };
    }
    return { ...sample, level: "L0", acceptingNewCapture: true };
  }

  halt(reason: string): void {
    this.externalHaltReason = reason.trim() || "external_halt";
  }

  clearHalt(): void {
    this.externalHaltReason = undefined;
  }

  close(): void {
    this.histogram?.disable();
  }

  private readSystemSample(): PressureSample {
    const totalMemory = os.totalmem();
    const memoryUsedRatio = totalMemory > 0 ? 1 - os.freemem() / totalMemory : 0;
    const eventLoopDelayMsP95 = this.histogram && this.histogram.count > 0
      ? this.histogram.percentile(95) / 1_000_000
      : 0;
    this.histogram?.reset();
    return {
      memoryUsedRatio: round(memoryUsedRatio),
      eventLoopDelayMsP95: round(eventLoopDelayMsP95)
    };
  }
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
