import assert from "node:assert/strict";
import test from "node:test";
import { acquireEndpointClaim, isExecutionPoolBackpressureError, releaseEndpointClaimForTest } from "../src/task-client.js";

test("one browser slot cannot enter two concurrent claim requests", () => {
  const endpoint = "worker-a:9223";
  assert.equal(acquireEndpointClaim(endpoint), true);
  assert.equal(acquireEndpointClaim(endpoint), false);
  releaseEndpointClaimForTest(endpoint);
  assert.equal(acquireEndpointClaim(endpoint), true);
  releaseEndpointClaimForTest(endpoint);
});

test("bounded execution pool duplicate and full errors are normal backpressure", () => {
  assert.equal(isExecutionPoolBackpressureError("pool_key_already_scheduled:mm:9421"), true);
  assert.equal(isExecutionPoolBackpressureError("pool_queue_full:capture"), true);
  assert.equal(isExecutionPoolBackpressureError("collector_failed"), false);
});
