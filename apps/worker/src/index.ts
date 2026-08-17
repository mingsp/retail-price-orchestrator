import { loadConfig } from "./config.js";
import { startWorkerConnection } from "./connection.js";
import { startCdpCommandPolling } from "./cdp-command-client.js";
import { startTaskPolling } from "./task-client.js";
import { startMutationSpoolReplay } from "./master-api.js";
import { workerLog } from "./observability.js";
import { prepareWorkerIdentity } from "./enrollment-client.js";
import { initializeExecutionRuntime } from "./execution-runtime.js";

const identity = await prepareWorkerIdentity();
const config = loadConfig(identity);
initializeExecutionRuntime(config);
workerLog("info", "worker.starting", {
  workerId: config.worker.workerId,
  masterBaseUrl: config.masterBaseUrl,
  accountSlots: config.accounts.length,
  cdpEndpoints: config.cdpEndpoints.length,
  taskExecutionEnabled: config.taskExecutionEnabled,
  collectorAdapter: config.collectorAdapter,
  captureConcurrency: config.captureConcurrency,
  productPipelineConcurrency: config.productPipelineConcurrency
});
console.log(`[worker] starting ${config.worker.workerId} -> ${config.masterBaseUrl}`);
console.log(`[worker] accounts: ${config.accounts.map((account) => `${account.accountId}@${account.cdpPort}`).join(", ")}`);
console.log(`[worker] cdp endpoints: ${config.cdpEndpoints.map((endpoint) => `${endpoint.endpointId || endpoint.port}@${endpoint.status}`).join(", ")}`);
console.log(`[worker] task polling: ${config.taskPollingEnabled ? "enabled" : "disabled"}`);
console.log(`[worker] task execution: ${config.taskExecutionEnabled ? "enabled" : "disabled"}`);
console.log(`[worker] cdp commands: ${config.cdpCommandPollingEnabled ? "enabled" : "disabled"}`);
console.log(`[worker] collector adapter: ${config.collectorAdapter}`);
console.log(`[worker] legacy collector: ${config.legacyScriptRoot}/${config.legacyScriptName}`);
console.log(`[worker] native collector: ${config.nativeScriptRoot}/${config.nativeScriptName}`);
if (config.runtimeRole === "core") {
  startWorkerConnection(config);
  startMutationSpoolReplay(config);
  startTaskPolling(config);
} else {
  startCdpCommandPolling(config);
}
