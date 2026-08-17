export interface BoundedExecutionPoolOptions {
  name: string;
  concurrency: number;
  maxQueueSize: number;
}

export interface PoolRunOptions {
  key: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PoolSnapshot {
  name: string;
  concurrency: number;
  maxQueueSize: number;
  active: number;
  waiting: number;
  rejected: number;
  completed: number;
  failed: number;
  queueWaitMsP95: number;
}

interface QueueJob<T> {
  key: string;
  enqueuedAt: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  operation: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  abortWhileWaiting?: () => void;
}

export class BoundedExecutionPool {
  private concurrency: number;
  private readonly maxQueueSize: number;
  private active = 0;
  private rejected = 0;
  private completed = 0;
  private failed = 0;
  private readonly waiting: QueueJob<unknown>[] = [];
  private readonly scheduledKeys = new Set<string>();
  private readonly queueWaitSamples: number[] = [];
  private readonly drainWaiters = new Set<() => void>();

  constructor(private readonly options: BoundedExecutionPoolOptions) {
    assertPositiveInteger(options.concurrency, "pool_concurrency_invalid");
    assertNonNegativeInteger(options.maxQueueSize, "pool_queue_size_invalid");
    if (!options.name.trim()) throw new Error("pool_name_required");
    this.concurrency = options.concurrency;
    this.maxQueueSize = options.maxQueueSize;
  }

  run<T>(options: PoolRunOptions, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const key = options.key.trim();
    if (!key) return Promise.reject(new Error("pool_key_required"));
    if (this.scheduledKeys.has(key)) {
      this.rejected++;
      return Promise.reject(new Error(`pool_key_already_scheduled:${key}`));
    }
    if (options.signal?.aborted) {
      this.rejected++;
      return Promise.reject(abortReason(options.signal, "pool_operation_aborted"));
    }
    if (this.active >= this.concurrency && this.waiting.length >= this.maxQueueSize) {
      this.rejected++;
      return Promise.reject(new Error(`pool_queue_full:${this.options.name}`));
    }

    this.scheduledKeys.add(key);
    return new Promise<T>((resolve, reject) => {
      const job: QueueJob<T> = {
        key,
        enqueuedAt: Date.now(),
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        operation,
        resolve,
        reject
      };
      if (this.active < this.concurrency) {
        void this.start(job);
        return;
      }
      if (options.signal) {
        job.abortWhileWaiting = () => {
          const index = this.waiting.indexOf(job as QueueJob<unknown>);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          this.scheduledKeys.delete(job.key);
          this.failed++;
          reject(abortReason(options.signal!, "pool_operation_aborted"));
          this.notifyDrainIfIdle();
        };
        options.signal.addEventListener("abort", job.abortWhileWaiting, { once: true });
      }
      this.waiting.push(job as QueueJob<unknown>);
    });
  }

  setConcurrency(value: number): void {
    assertPositiveInteger(value, "pool_concurrency_invalid");
    this.concurrency = value;
    this.pump();
  }

  snapshot(): PoolSnapshot {
    return {
      name: this.options.name,
      concurrency: this.concurrency,
      maxQueueSize: this.maxQueueSize,
      active: this.active,
      waiting: this.waiting.length,
      rejected: this.rejected,
      completed: this.completed,
      failed: this.failed,
      queueWaitMsP95: percentile95(this.queueWaitSamples)
    };
  }

  drain(): Promise<void> {
    if (this.active === 0 && this.waiting.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.drainWaiters.add(resolve));
  }

  private async start<T>(job: QueueJob<T>): Promise<void> {
    job.signal?.removeEventListener("abort", job.abortWhileWaiting!);
    this.active++;
    this.recordQueueWait(Date.now() - job.enqueuedAt);

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(abortReason(job.signal!, "pool_operation_aborted"));
    job.signal?.addEventListener("abort", abortFromCaller, { once: true });
    let timeout: NodeJS.Timeout | undefined;
    if (job.timeoutMs !== undefined) {
      if (!Number.isFinite(job.timeoutMs) || job.timeoutMs <= 0) {
        controller.abort(new Error("pool_timeout_invalid"));
      } else {
        timeout = setTimeout(
          () => controller.abort(new Error(`pool_operation_timeout:${this.options.name}:${job.key}`)),
          job.timeoutMs
        );
      }
    }

    const operationPromise = Promise.resolve().then(() => job.operation(controller.signal));
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectOnAbort = () => reject(abortReason(controller.signal, "pool_operation_aborted"));
      if (controller.signal.aborted) rejectOnAbort();
      else controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
    });
    const resultPromise = Promise.race([operationPromise, abortPromise]);
    resultPromise.then(job.resolve, job.reject);

    try {
      await operationPromise;
      if (controller.signal.aborted) this.failed++;
      else this.completed++;
    } catch {
      this.failed++;
    } finally {
      if (timeout) clearTimeout(timeout);
      job.signal?.removeEventListener("abort", abortFromCaller);
      this.active--;
      this.scheduledKeys.delete(job.key);
      this.pump();
      this.notifyDrainIfIdle();
    }
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      void this.start(next);
    }
  }

  private recordQueueWait(value: number): void {
    this.queueWaitSamples.push(Math.max(0, value));
    if (this.queueWaitSamples.length > 512) this.queueWaitSamples.shift();
  }

  private notifyDrainIfIdle(): void {
    if (this.active !== 0 || this.waiting.length !== 0) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }
}

function abortReason(signal: AbortSignal, fallback: string): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (signal.reason !== undefined) return new Error(String(signal.reason));
  return new Error(fallback);
}

function percentile95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

function assertPositiveInteger(value: number, error: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(error);
}

function assertNonNegativeInteger(value: number, error: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(error);
}
