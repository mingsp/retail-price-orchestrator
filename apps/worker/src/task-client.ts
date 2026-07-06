import type { TaskClaimInput, TaskClaimResult } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";

export function startTaskPolling(config: WorkerConfig): void {
  if (!config.taskPollingEnabled) {
    console.log("[worker] task polling disabled");
    return;
  }

  console.log(`[worker] task polling enabled: ${config.taskPollingIntervalMs}ms`);
  void pollOnce(config);
  setInterval(() => {
    void pollOnce(config);
  }, config.taskPollingIntervalMs);
}

async function pollOnce(config: WorkerConfig): Promise<void> {
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
    console.log(
      `[worker] claimed task ${result.task.taskId}: ${result.task.storeName || result.task.storeId} / ${result.task.categoryName}`
    );
    return;
  }
  console.log(`[worker] no task claimed: ${result.reason || "unknown"}`);
}
