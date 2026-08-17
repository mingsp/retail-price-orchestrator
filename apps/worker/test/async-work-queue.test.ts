import assert from "node:assert/strict";
import test from "node:test";
import { AsyncWorkQueue } from "../src/async-work-queue.js";

test("pipeline queue applies backpressure at the configured concurrency", async () => {
  const queue = new AsyncWorkQueue(1);
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const run = (name: string) => queue.run(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    order.push(`start:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(`end:${name}`);
    active--;
  });

  await Promise.all([run("a"), run("b"), run("c")]);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  assert.deepEqual(queue.snapshot(), { active: 0, waiting: 0, concurrency: 1 });
});
