import assert from "node:assert/strict";
import test from "node:test";
import { BoundedExecutionPool } from "../src/bounded-execution-pool.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("bounded pool limits concurrency and drains FIFO work", async () => {
  const pool = new BoundedExecutionPool({ name: "capture", concurrency: 2, maxQueueSize: 2 });
  const first = deferred();
  const second = deferred();
  const order: string[] = [];

  const a = pool.run({ key: "a" }, async () => {
    order.push("start:a");
    await first.promise;
    order.push("end:a");
  });
  const b = pool.run({ key: "b" }, async () => {
    order.push("start:b");
    await second.promise;
    order.push("end:b");
  });
  const c = pool.run({ key: "c" }, async () => {
    order.push("start:c");
    order.push("end:c");
  });

  await new Promise((resolve) => setImmediate(resolve));
  const { queueWaitMsP95, ...snapshot } = pool.snapshot();
  assert.deepEqual(snapshot, {
    name: "capture",
    concurrency: 2,
    maxQueueSize: 2,
    active: 2,
    waiting: 1,
    rejected: 0,
    completed: 0,
    failed: 0
  });
  assert.ok(queueWaitMsP95 >= 0);

  first.resolve();
  await a;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order.slice(0, 4), ["start:a", "start:b", "end:a", "start:c"]);

  second.resolve();
  await Promise.all([b, c]);
  await pool.drain();
  assert.equal(pool.snapshot().active, 0);
  assert.equal(pool.snapshot().waiting, 0);
  assert.equal(pool.snapshot().completed, 3);
});

test("bounded pool rejects duplicate keys and queue overflow", async () => {
  const pool = new BoundedExecutionPool({ name: "capture", concurrency: 1, maxQueueSize: 1 });
  const blocker = deferred();
  const active = pool.run({ key: "cdp-1" }, () => blocker.promise);

  await assert.rejects(pool.run({ key: "cdp-1" }, async () => undefined), /pool_key_already_scheduled/);
  const waiting = pool.run({ key: "cdp-2" }, async () => undefined);
  await assert.rejects(pool.run({ key: "cdp-3" }, async () => undefined), /pool_queue_full/);
  assert.equal(pool.snapshot().rejected, 2);

  blocker.resolve();
  await Promise.all([active, waiting]);
});

test("bounded pool removes an aborted waiting task", async () => {
  const pool = new BoundedExecutionPool({ name: "capture", concurrency: 1, maxQueueSize: 2 });
  const blocker = deferred();
  const active = pool.run({ key: "active" }, () => blocker.promise);
  const controller = new AbortController();
  const waiting = pool.run({ key: "waiting", signal: controller.signal }, async () => undefined);

  controller.abort(new Error("lease_lost"));
  await assert.rejects(waiting, /lease_lost/);
  assert.equal(pool.snapshot().waiting, 0);

  blocker.resolve();
  await active;
});

test("bounded pool reports timeout but retains the key until work settles", async () => {
  const pool = new BoundedExecutionPool({ name: "pipeline", concurrency: 1, maxQueueSize: 1 });
  const blocker = deferred();
  const timedOut = pool.run({ key: "task-1", timeoutMs: 10 }, async () => blocker.promise);

  await assert.rejects(timedOut, /pool_operation_timeout/);
  await assert.rejects(pool.run({ key: "task-1" }, async () => undefined), /pool_key_already_scheduled/);
  assert.equal(pool.snapshot().active, 1);

  blocker.resolve();
  await pool.drain();
  assert.equal(pool.snapshot().active, 0);
});

test("bounded pool can shrink without interrupting active work", async () => {
  const pool = new BoundedExecutionPool({ name: "capture", concurrency: 2, maxQueueSize: 2 });
  const first = deferred();
  const second = deferred();
  const a = pool.run({ key: "a" }, () => first.promise);
  const b = pool.run({ key: "b" }, () => second.promise);
  const c = pool.run({ key: "c" }, async () => undefined);

  pool.setConcurrency(1);
  first.resolve();
  await a;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pool.snapshot().active, 1);
  assert.equal(pool.snapshot().waiting, 1);

  second.resolve();
  await Promise.all([b, c]);
});
