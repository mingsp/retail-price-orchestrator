import type { TaskClaimInput, TaskClaimResult } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { runLegacyCollector } from "./legacy-collector.js";

let activeTaskId = "";

export function startTaskPolling(config: WorkerConfig): void {
  if (!config.taskPollingEnabled) {
    console.log("[worker] task polling disabled");
    return;
  }
  if (!config.taskExecutionEnabled) {
    console.log("[worker] task polling requested, but task execution disabled; no tasks will be claimed");
    return;
  }

  console.log(`[worker] task polling and execution enabled: ${config.taskPollingIntervalMs}ms`);
  void pollOnce(config);
  setInterval(() => {
    void pollOnce(config);
  }, config.taskPollingIntervalMs);
}

async function pollOnce(config: WorkerConfig): Promise<void> {
  if (activeTaskId) {
    console.log(`[worker] task already running: ${activeTaskId}`);
    return;
  }

  const account = config.accounts.find(
    (candidate) =>
      ["safe", "running"].includes(candidate.status) &&
      candidate.profileStatus === "safe" &&
      !["high", "blocked"].includes(candidate.riskLevel)
  );
  if (!account) {
    console.log("[worker] no eligible account for task polling");
    return;
  }

  const claim: TaskClaimInput = {
    workerId: config.worker.workerId,
    accountId: account.accountId,
    profileId: account.profileId
  };

  const url = new URL("/api/tasks/claim", config.masterBaseUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(claim)
  });
  if (!response.ok) {
    console.error(`[worker] task claim failed: ${response.status}`);
    return;
  }

  const result = (await response.json()) as TaskClaimResult;
  if (result.task) {
    activeTaskId = result.task.taskId;
    console.log(
      `[worker] claimed task ${result.task.taskId}: ${result.task.storeName || result.task.storeId} / ${result.task.categoryName}`
    );
    try {
      await runLegacyCollector({ config, task: result.task, account });
    } catch (error) {
      console.error(`[worker] task execution failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      activeTaskId = "";
    }
    return;
  }
  console.log(`[worker] no task claimed: ${result.reason || "unknown"}`);
}
