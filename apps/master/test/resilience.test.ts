import assert from "node:assert/strict";
import test from "node:test";
import { checkDependency, DependencyTimeoutError, runBestEffort, withTimeout } from "../src/resilience.js";

test("dependency checks return degraded state instead of throwing", async () => {
  const result = await checkDependency("redis", async () => {
    throw new Error("connection refused");
  });
  assert.equal(result.ok, false);
  assert.match(result.error || "", /connection refused/);
});

test("dependency timeout is bounded", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => undefined), 10, "object storage"),
    DependencyTimeoutError
  );
});

test("best effort side channel does not fail the durable caller", async () => {
  let observed: unknown;
  const ok = await runBestEffort("redis publish", async () => {
    throw new Error("redis down");
  }, (error) => { observed = error; });
  assert.equal(ok, false);
  assert.match(String(observed), /redis down/);
});
