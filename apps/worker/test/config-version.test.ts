import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkerAgentVersion, resolveWorkerMachineLabel } from "../src/config.js";

test("Worker agent version prefers the immutable release environment", () => {
  assert.equal(resolveWorkerAgentVersion({ WORKER_AGENT_VERSION: "2.3.4-prod.1" }), "2.3.4-prod.1");
});

test("Worker agent version rejects values that cannot be compared by deployment health checks", () => {
  assert.throws(() => resolveWorkerAgentVersion({ WORKER_AGENT_VERSION: "latest" }), /worker_agent_version_invalid/);
});

test("Worker machine label decodes the UTF-8 base64 transport value", () => {
  assert.equal(resolveWorkerMachineLabel({
    WORKER_MACHINE_LABEL: "corrupted fallback",
    WORKER_MACHINE_LABEL_BASE64: Buffer.from("天兴商圈比价 Worker", "utf8").toString("base64")
  }, "worker-fallback"), "天兴商圈比价 Worker");
});

test("Worker machine label remains backward compatible with the plain value", () => {
  assert.equal(resolveWorkerMachineLabel({ WORKER_MACHINE_LABEL: "worker-44" }, "worker-fallback"), "worker-44");
});

test("Worker machine label rejects an invalid base64 transport value", () => {
  assert.throws(() => resolveWorkerMachineLabel({
    WORKER_MACHINE_LABEL_BASE64: "not base64"
  }, "worker-fallback"), /worker_machine_label_base64_invalid/);
});
