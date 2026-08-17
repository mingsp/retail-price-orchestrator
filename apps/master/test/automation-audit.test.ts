import assert from "node:assert/strict";
import test from "node:test";
import { buildAutomationAudit } from "../src/repositories/automation-audit.js";

test("automation audit identifies offline workers open risks and stalled tasks", () => {
  const report = buildAutomationAudit({
    now: new Date("2026-07-15T10:30:00.000Z"),
    workers: [{ worker: { workerId: "worker-jl", status: "offline" } } as any],
    tasks: [{ taskId: "task-1", status: "collecting", updatedAt: "2026-07-15T09:00:00.000Z", categoryName: "饮料", storeId: "store-a" } as any],
    risks: [{ riskId: "risk-1", status: "open", severity: "high", riskType: "captcha", workerId: "worker-jl" } as any],
    runs: []
  });

  assert.deepEqual(report.issues.map((issue) => issue.code).sort(), ["open_risk", "stalled_task", "worker_offline"]);
  assert.equal(report.summary.blockers, 2);
});

test("automation audit never invents an issue for a healthy idle system", () => {
  const report = buildAutomationAudit({
    now: new Date(),
    workers: [{ worker: { workerId: "worker-mm", status: "online" } } as any],
    tasks: [],
    risks: [],
    runs: []
  });
  assert.equal(report.issues.length, 0);
  assert.equal(report.summary.status, "healthy");
});
