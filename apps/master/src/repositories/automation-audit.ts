import type {
  CategoryTaskRecord,
  RiskEventRecord,
  RunProgressRecord,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { listRiskEvents } from "./risk-events.js";
import { listRunProgress } from "./run-progress.js";
import { listTasks } from "./tasks.js";
import { listWorkers } from "./workers.js";

export interface AutomationAuditIssue {
  code: "worker_offline" | "stalled_task" | "open_risk" | "run_attention";
  severity: "warning" | "blocker";
  summary: string;
  workerId?: string;
  taskId?: string;
  runId?: string;
  riskId?: string;
  safeActions: string[];
}

export interface AutomationAuditReport {
  generatedAt: string;
  summary: {
    status: "healthy" | "attention" | "blocked";
    blockers: number;
    warnings: number;
    onlineWorkers: number;
    activeTasks: number;
    openRisks: number;
  };
  issues: AutomationAuditIssue[];
}

export interface AutomationAuditInput {
  now: Date;
  workers: WorkerStatusRow[];
  tasks: CategoryTaskRecord[];
  risks: RiskEventRecord[];
  runs: RunProgressRecord[];
}

const activeTaskStatuses = new Set(["assigned", "running", "collecting", "captured", "uploading", "structuring", "validating"]);

export function buildAutomationAudit(input: AutomationAuditInput): AutomationAuditReport {
  const issues: AutomationAuditIssue[] = [];
  for (const row of input.workers) {
    if (row.worker.status === "online") continue;
    issues.push({
      code: "worker_offline",
      severity: "blocker",
      summary: `采集设备 ${row.worker.machineLabel || row.worker.workerId} 当前离线`,
      workerId: row.worker.workerId,
      safeActions: ["diagnostic_bundle"]
    });
  }
  for (const task of input.tasks) {
    if (!activeTaskStatuses.has(task.status)) continue;
    const lastActivity = Date.parse(task.lastProgressAt || task.updatedAt);
    if (Number.isFinite(lastActivity) && input.now.getTime() - lastActivity < 20 * 60 * 1000) continue;
    issues.push({
      code: "stalled_task",
      severity: "warning",
      summary: `${task.storeName || task.storeId} / ${task.categoryName} 超过 20 分钟没有新进度`,
      taskId: task.taskId,
      runId: task.runId,
      safeActions: ["pause", "resume"]
    });
  }
  for (const risk of input.risks.filter((item) => item.status !== "resolved")) {
    issues.push({
      code: "open_risk",
      severity: risk.severity === "critical" || risk.severity === "high" ? "blocker" : "warning",
      summary: `${risk.storeName || risk.storeId || "目标门店"} 存在待处理风险`,
      workerId: risk.workerId,
      riskId: risk.riskId,
      safeActions: ["diagnostic_bundle"]
    });
  }
  for (const run of input.runs.filter((item) => item.attentionCategories > 0)) {
    issues.push({
      code: "run_attention",
      severity: "warning",
      summary: `${run.storeName || run.storeId} 有 ${run.attentionCategories} 个类目需要处理`,
      runId: run.runId,
      safeActions: []
    });
  }
  const blockers = issues.filter((issue) => issue.severity === "blocker").length;
  const warnings = issues.length - blockers;
  return {
    generatedAt: input.now.toISOString(),
    summary: {
      status: blockers ? "blocked" : warnings ? "attention" : "healthy",
      blockers,
      warnings,
      onlineWorkers: input.workers.filter((row) => row.worker.status === "online").length,
      activeTasks: input.tasks.filter((task) => activeTaskStatuses.has(task.status)).length,
      openRisks: input.risks.filter((risk) => risk.status !== "resolved").length
    },
    issues
  };
}

export async function getAutomationAudit(db: Pool): Promise<AutomationAuditReport> {
  const [workers, tasks, risks, runs] = await Promise.all([
    listWorkers(db),
    listTasks(db),
    listRiskEvents(db),
    listRunProgress(db)
  ]);
  return buildAutomationAudit({ now: new Date(), workers, tasks, risks, runs });
}
