export interface MasterConfig {
  port: number;
  workerSharedToken: string;
  dingtalkWebhookUrl?: string;
  databaseUrl: string;
  redisUrl: string;
  s3: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    region: string;
    forcePathStyle: boolean;
  };
}

export function loadConfig(): MasterConfig {
  return {
    port: Number(process.env.MASTER_PORT || 17890),
    workerSharedToken: process.env.WORKER_SHARED_TOKEN || "change-me",
    dingtalkWebhookUrl: process.env.DINGTALK_WEBHOOK_URL || undefined,
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgres://retail:retail@127.0.0.1:55432/retail_orchestrator",
    redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:56379",
    s3: {
      endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:59000",
      accessKey: process.env.S3_ACCESS_KEY || "retail",
      secretKey: process.env.S3_SECRET_KEY || "retail-password",
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") === "true"
    }
  };
}
