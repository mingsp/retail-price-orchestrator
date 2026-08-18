import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AccountSnapshot, CategoryTaskRecord } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "../src/config.js";
import { runLegacyCollector } from "../src/legacy-collector.js";
import { bindTaskLeaseGuard, clearTaskLeaseGuard } from "../src/master-api.js";
import { runNativeCollector } from "../src/native-collector.js";

test("native collector start request preserves Master-owned assignment", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-task-write-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "collector.mjs"), "process.exit(0);\n", "utf8");
  const config = makeConfig({
    nativeScriptRoot: root,
    nativeScriptName: "collector.mjs",
    nativeOutputRoot: path.join(root, "output")
  });
  const body = await captureTaskPatch("native-task", () => runNativeCollector({
    config,
    task: makeTask("native-task"),
    account: makeAccount()
  }));

  assert.equal(body.status, "collecting");
  assert.deepEqual(body.expectedLeaseOwner, "worker-a");
  assert.deepEqual(body.expectedLeaseGeneration, 7);
  assertAssignmentFieldsAbsent(body);
});

test("legacy collector start request preserves Master-owned assignment", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-task-write-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "collector.mjs"), "process.exit(0);\n", "utf8");
  await fs.writeFile(path.join(root, `meituan-natural-responses-${shanghaiDate()}.jsonl`), "", "utf8");
  const config = makeConfig({ legacyScriptRoot: root, legacyScriptName: "collector.mjs" });
  const body = await captureTaskPatch("legacy-task", () => runLegacyCollector({
    config,
    task: makeTask("legacy-task"),
    account: makeAccount()
  }));

  assert.equal(body.status, "running");
  assert.deepEqual(body.expectedLeaseOwner, "worker-a");
  assert.deepEqual(body.expectedLeaseGeneration, 7);
  assertAssignmentFieldsAbsent(body);
});

test("legacy collector terminates when its lease signal is aborted", { timeout: 15_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-task-abort-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "collector.mjs"), "setInterval(() => {}, 1000);\n", "utf8");
  await fs.writeFile(path.join(root, `meituan-natural-responses-${shanghaiDate()}.jsonl`), "", "utf8");
  const config = makeConfig({ legacyScriptRoot: root, legacyScriptName: "collector.mjs" });
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  bindTaskLeaseGuard("legacy-abort", "worker-a", 7);
  globalThis.fetch = async () => new Response(JSON.stringify({ task: makeTask("legacy-abort") }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

  try {
    const running = runLegacyCollector({
      config,
      task: makeTask("legacy-abort"),
      account: makeAccount(),
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(running, /legacy_collector_aborted/);
  } finally {
    clearTaskLeaseGuard("legacy-abort");
    globalThis.fetch = originalFetch;
  }
});

async function captureTaskPatch(taskId: string, send: () => Promise<void>): Promise<Record<string, unknown>> {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  bindTaskLeaseGuard(taskId, "worker-a", 7);
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    throw new Error("request_captured");
  };

  try {
    await assert.rejects(send, /request_captured/);
  } finally {
    clearTaskLeaseGuard(taskId);
    globalThis.fetch = originalFetch;
  }

  assert.ok(body);
  return body;
}

function makeConfig(overrides: Partial<WorkerConfig>): WorkerConfig {
  return {
    masterBaseUrl: "http://master.test",
    masterRequestTimeoutMs: 1_000,
    workerToken: "worker-token",
    worker: { workerId: "worker-a" },
    categoryPlanFile: "",
    ...overrides
  } as WorkerConfig;
}

function makeTask(taskId: string): CategoryTaskRecord {
  return {
    taskId,
    runId: "run-1",
    storeId: "store-1",
    categoryName: "Beverages",
    cursor: {},
    collectedItems: 0
  } as CategoryTaskRecord;
}

function makeAccount(): AccountSnapshot {
  return {
    accountId: "account-a",
    profileId: "profile-a",
    displayName: "Account A",
    profilePath: "C:\\profiles\\account-a",
    cdpPort: 9222
  } as AccountSnapshot;
}

function shanghaiDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replaceAll("-", "");
}

function assertAssignmentFieldsAbsent(body: Record<string, unknown>): void {
  for (const field of [
    "assignedWorkerId",
    "assignedAccountId",
    "assignedProfileId",
    "assignedCdpEndpointId"
  ]) {
    assert.equal(field in body, false, `${field} must remain Master-owned`);
  }
}
