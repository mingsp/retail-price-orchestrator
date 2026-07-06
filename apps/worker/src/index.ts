import { loadConfig } from "./config.js";
import { startWorkerConnection } from "./connection.js";
import { startTaskPolling } from "./task-client.js";

const config = loadConfig();
console.log(`[worker] starting ${config.worker.workerId} -> ${config.masterBaseUrl}`);
console.log(`[worker] accounts: ${config.accounts.map((account) => `${account.accountId}@${account.cdpPort}`).join(", ")}`);
console.log(`[worker] task polling: ${config.taskPollingEnabled ? "enabled" : "disabled"}`);
console.log(`[worker] task execution: ${config.taskExecutionEnabled ? "enabled" : "disabled"}`);
console.log(`[worker] legacy collector: ${config.legacyScriptRoot}/${config.legacyScriptName}`);
startWorkerConnection(config);
startTaskPolling(config);
