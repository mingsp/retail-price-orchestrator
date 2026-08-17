import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { createDb, ensureSchema } from "./db.js";
import { createS3Client, ensureBuckets } from "./s3.js";
import { buildServer } from "./server.js";
import { aggregateAllActiveStoreRuns } from "./repositories/run-progress.js";
import { withTimeout } from "./resilience.js";
import { createDingTalkTransport, startNotificationDispatcher } from "./notification-dispatcher.js";
import {
  PostgresNotificationDeliveryStore,
  recoverStalledNotificationDeliveries
} from "./repositories/notification-outbox.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const redis = new Redis(config.redisUrl, {
  connectTimeout: 3_000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(10_000, 500 * attempt)
});
redis.on("error", (error) => console.error("[master] redis degraded", error.message));
const s3 = createS3Client(config.s3);
const s3Public = createS3Client(config.s3Public);

await ensureSchema(db);
await recoverStalledNotificationDeliveries(db);
await aggregateAllActiveStoreRuns(db);
await withTimeout(ensureBuckets(s3), 5_000, "minio startup check").catch((error) => {
  console.warn("[master] object storage degraded at startup; readiness will remain blocked", error);
});

const app = await buildServer({
  db,
  redis,
  s3,
  s3Public,
  masterPublicBaseUrl: config.masterPublicBaseUrl,
  workerSharedToken: config.workerSharedToken,
  allowLegacyWorkerSharedToken: config.allowLegacyWorkerSharedToken,
  automationToken: config.automationToken,
  operatorToken: config.operatorToken,
  registrySyncToken: config.registrySyncToken,
  registrySchemaHash: config.registrySchemaHash,
  operatorAllowedOrigins: config.operatorAllowedOrigins,
  dingtalkWebhookUrl: config.dingtalkWebhookUrl,
  retailMart: config.retailMart
});

await app.listen({ port: config.port, host: "0.0.0.0" });

let stopNotificationDispatcher: () => void = () => undefined;
if (config.dingtalkWebhookUrl) {
  stopNotificationDispatcher = startNotificationDispatcher({
    store: new PostgresNotificationDeliveryStore(db),
    transport: createDingTalkTransport(config.dingtalkWebhookUrl),
    logger: app.log
  });
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "graceful shutdown started");
  stopNotificationDispatcher();
  await app.close();
  redis.disconnect();
  await db.end();
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
