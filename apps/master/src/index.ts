import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { createDb, ensureSchema } from "./db.js";
import { createS3Client, ensureBuckets } from "./s3.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const redis = new Redis(config.redisUrl);
const s3 = createS3Client(config.s3);

await ensureSchema(db);
await ensureBuckets(s3);

const app = await buildServer({
  db,
  redis,
  s3,
  workerSharedToken: config.workerSharedToken
});

await app.listen({ port: config.port, host: "0.0.0.0" });
