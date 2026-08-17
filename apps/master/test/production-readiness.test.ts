import assert from "node:assert/strict";
import test from "node:test";
import type { CategoryTaskRecord, WorkerStatusRow } from "@retail-orchestrator/shared";
import { buildProductionReadinessReport } from "../src/repositories/production-readiness.js";

function makeWorker(overrides: Partial<WorkerStatusRow> = {}): WorkerStatusRow {
  return {
    worker: {
      workerId: "mm-worker",
      machineLabel: "mm Windows",
      hostname: "mm",
      os: "Windows",
      agentVersion: "0.1.0",
      status: "online",
      networkMode: "direct",
      codexOperator: true,
      capabilities: ["chrome_cdp"],
      bootId: "boot-mm-1",
      startedAt: "2026-07-09T09:00:00.000Z",
      currentIp: "192.0.2.10",
      diskFreeBytes: 10 * 1024 ** 3,
      clockOffsetMs: 0,
      remoteDesktop: { provider: "rustdesk", target: "mm-worker", status: "ready" },
      lastSeenAt: "2026-07-09T10:00:00.000Z"
    },
    accounts: [
      {
        accountId: "account-a",
        displayName: "LIGOUDA-A01",
        maskedLogin: "183****2030",
        status: "safe",
        riskLevel: "normal",
        profileId: "profile-a",
        profileStatus: "safe",
        profilePath: "browser-profiles/profile-a",
        cdpPort: 9301,
        cdpEndpoint: "http://127.0.0.1:9301",
        currentStoreName: "LIGOUDA-JINGYAO"
      }
    ],
    cdpEndpoints: [
      {
        endpointId: "mm-worker:9301",
        workerId: "mm-worker",
        host: "127.0.0.1",
        port: 9301,
        endpointUrl: "http://127.0.0.1:9301",
        status: "ready",
        profileId: "profile-a",
        accountId: "account-a",
        accountDisplayName: "LIGOUDA-A01",
        maskedLogin: "183****2030",
        targetStoreName: "LIGOUDA-JINGYAO",
        updatedAt: "2026-07-09T10:00:00.000Z"
      }
    ],
    ...overrides
  };
}

function makeTask(overrides: Partial<CategoryTaskRecord> = {}): CategoryTaskRecord {
  return {
    taskId: "task-1",
    runId: "run-1",
    storeId: "store-1",
    storeName: "Store",
    categoryName: "日用百货",
    categoryOrder: 1,
    status: "running",
    priority: 10,
    assignedWorkerId: "mm-worker",
    assignedAccountId: "account-a",
    assignedProfileId: "profile-a",
    assignedCdpEndpointId: "mm-worker:9301",
    missingSpuCount: 0,
    collectedItems: 10,
    cursor: {},
    createdAt: "2026-07-09T09:00:00.000Z",
    updatedAt: "2026-07-09T10:00:00.000Z",
    ...overrides
  };
}

test("production readiness passes for a clean worker/account/cdp set", () => {
  const report = buildProductionReadinessReport({
    workers: [makeWorker()],
    stores: [],
    runs: [],
    tasks: [],
    risks: [],
    options: { expectedWorkerIds: ["mm-worker"], expectedAccountCount: 1, expectedCdpCount: 1 },
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "ready");
  assert.equal(report.summary.blockers, 0);
});

test("production readiness blocks collection when DingTalk intervention notifications are not configured", () => {
  const report = buildProductionReadinessReport({
    workers: [makeWorker()],
    stores: [],
    runs: [],
    tasks: [],
    risks: [],
    dingtalkNotificationConfigured: false,
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((item) => item.id === "system:dingtalk-notification-missing"));
});

test("production readiness blocks debug workers and placeholder login markers", () => {
  const report = buildProductionReadinessReport({
    workers: [
      makeWorker({
        worker: { ...makeWorker().worker, workerId: "jl-worker-debug", machineLabel: "jl debug" },
        accounts: [{ ...makeWorker().accounts[0], accountId: "test", displayName: "test", maskedLogin: "LOGIN-PENDING" }],
        cdpEndpoints: [{ ...makeWorker().cdpEndpoints![0], endpointId: "jl-worker-debug:19304", workerId: "jl-worker-debug", maskedLogin: "LOGIN-PENDING" }]
      })
    ],
    stores: [],
    runs: [],
    tasks: [],
    risks: [],
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.id.startsWith("worker:placeholder")));
  assert.ok(report.issues.some((issue) => issue.id.startsWith("account:missing-login")));
});

test("production readiness blocks risky assigned accounts and duplicate active cdp tasks", () => {
  const report = buildProductionReadinessReport({
    workers: [
      makeWorker({
        accounts: [{ ...makeWorker().accounts[0], status: "manual_required", riskLevel: "high" }]
      })
    ],
    stores: [],
    runs: [],
    tasks: [
      makeTask({ taskId: "task-1" }),
      makeTask({ taskId: "task-2", categoryName: "饮料酒水" })
    ],
    risks: [],
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.id === "account:risk:account-a"));
  assert.ok(report.issues.some((issue) => issue.id === "task:duplicate-active-cdp:mm-worker:9301"));
});

test("production readiness blocks fixed-assignment tasks with cleared bindings", () => {
  const report = buildProductionReadinessReport({
    workers: [makeWorker()],
    stores: [],
    runs: [],
    tasks: [
      makeTask({
        status: "pending",
        assignedAccountId: undefined,
        assignedCdpEndpointId: undefined,
        cursor: {
          fixedAccountAssignment: true,
          fixedAssignedWorkerId: "mm-worker",
          fixedAssignedAccountId: "account-a",
          fixedAssignedProfileId: "profile-a",
          fixedAssignedCdpEndpointId: "mm-worker:9301"
        }
      })
    ],
    risks: [],
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.id === "task:fixed-missing-account:task-1"));
  assert.ok(report.issues.some((issue) => issue.id === "task:fixed-missing-cdp:task-1"));
});

test("production readiness blocks default worker shared token", () => {
  const report = buildProductionReadinessReport({
    workers: [makeWorker()],
    stores: [],
    runs: [],
    tasks: [],
    risks: [],
    workerSharedTokenIsDefault: true,
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.id === "system:default-worker-token"));
});

test("production readiness blocks workers that cannot be handled remotely", () => {
  const base = makeWorker();
  const report = buildProductionReadinessReport({
    workers: [makeWorker({
      worker: {
        ...base.worker,
        remoteDesktop: { provider: "none", status: "unavailable" }
      }
    })],
    stores: [],
    runs: [],
    tasks: [],
    risks: [],
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.id === "worker:remote-desktop:mm-worker"));
});

test("production readiness blocks low disk and excessive clock drift", () => {
  const base = makeWorker();
  const report = buildProductionReadinessReport({
    workers: [makeWorker({
      worker: {
        ...base.worker,
        diskFreeBytes: 4 * 1024 ** 3,
        clockOffsetMs: 30_001
      }
    })],
    stores: [],
    runs: [],
    tasks: [],
    risks: [],
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.id === "worker:disk:mm-worker"));
  assert.ok(report.issues.some((issue) => issue.id === "worker:clock:mm-worker"));
});

test("production readiness blocks incompatible worker versions", () => {
  const base = makeWorker();
  const report = buildProductionReadinessReport({
    workers: [makeWorker({ worker: { ...base.worker, agentVersion: "0.0.9" } })],
    stores: [],
    runs: [],
    tasks: [],
    risks: [],
    options: { minimumWorkerVersion: "0.1.0" },
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some((issue) => issue.id === "worker:version:mm-worker"));
});

test("production readiness never exposes local paths or urls from risk evidence", () => {
  const report = buildProductionReadinessReport({
    workers: [makeWorker()],
    stores: [],
    runs: [],
    tasks: [],
    risks: [{
      riskId: "risk-1",
      type: "worker.risk_event",
      sentAt: "2026-07-09T10:00:00.000Z",
      createdAt: "2026-07-09T10:00:00.000Z",
      status: "open",
      severity: "high",
      riskType: "interface_403",
      workerId: "mm-worker",
      accountId: "account-a",
      storeName: "Store",
      categoryName: "日用百货",
      observed: "page_state https://example.com resume=F:\\runtime\\task\\resume.ok",
      recommendedAction: "人工处理"
    }],
    now: new Date("2026-07-09T10:00:00.000Z")
  });

  const riskIssue = report.issues.find((issue) => issue.id === "risk:open:risk-1");
  assert.ok(riskIssue);
  assert.doesNotMatch(riskIssue.detail, /https?:\/\//i);
  assert.doesNotMatch(riskIssue.detail, /[A-Z]:\\/i);
  assert.doesNotMatch(riskIssue.detail, /resume=/i);
});
