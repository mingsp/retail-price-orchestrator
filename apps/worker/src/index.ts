import { loadConfig } from "./config.js";
import { startWorkerConnection } from "./connection.js";

const config = loadConfig();
console.log(`[worker] starting ${config.worker.workerId} -> ${config.masterBaseUrl}`);
console.log(`[worker] accounts: ${config.accounts.map((account) => `${account.accountId}@${account.cdpPort}`).join(", ")}`);
startWorkerConnection(config);

