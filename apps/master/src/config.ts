export interface MasterConfig {
  port: number;
  masterPublicBaseUrl: string;
  workerSharedToken: string;
  allowLegacyWorkerSharedToken: boolean;
  automationToken?: string;
  operatorToken?: string;
  registrySyncToken?: string;
  registrySchemaHash?: string;
  operatorAllowedOrigins: string[];
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
  s3Public: MasterConfig["s3"];
  retailMart?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    charset: string;
    timezone: string;
  };
}

export function loadConfig(): MasterConfig {
  const port = Number(process.env.MASTER_PORT || 17890);
  const masterPublicBaseUrl = process.env.MASTER_PUBLIC_BASE_URL || `http://127.0.0.1:${port}`;
  const retailMart = process.env.RETAILMART_DB_HOST && process.env.RETAILMART_DB_USER && process.env.RETAILMART_DB_PASSWORD && process.env.RETAILMART_DB_NAME
    ? {
        host: process.env.RETAILMART_DB_HOST,
        port: Number(process.env.RETAILMART_DB_PORT || 3306),
        user: process.env.RETAILMART_DB_USER,
        password: process.env.RETAILMART_DB_PASSWORD,
        database: process.env.RETAILMART_DB_NAME,
        charset: process.env.RETAILMART_DB_CHARSET || "utf8mb4",
        timezone: process.env.RETAILMART_DB_TIMEZONE || "+08:00"
      }
    : undefined;
  const s3 = {
    endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:59000",
    accessKey: process.env.S3_ACCESS_KEY || "retail",
    secretKey: process.env.S3_SECRET_KEY || "retail-password",
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true") === "true"
  };
  return {
    port,
    masterPublicBaseUrl,
    workerSharedToken: process.env.WORKER_SHARED_TOKEN || "change-me",
    allowLegacyWorkerSharedToken: process.env.ALLOW_LEGACY_WORKER_SHARED_TOKEN === "true",
    automationToken: process.env.AUTOMATION_TOKEN || undefined,
    operatorToken: process.env.OPERATOR_TOKEN || undefined,
    registrySyncToken: process.env.REGISTRY_SYNC_TOKEN || undefined,
    registrySchemaHash: process.env.REGISTRY_SCHEMA_HASH || undefined,
    operatorAllowedOrigins: parseAllowedOrigins(process.env.OPERATOR_ALLOWED_ORIGINS, masterPublicBaseUrl),
    dingtalkWebhookUrl: normalizeDingTalkWebhookUrl(process.env.DINGTALK_WEBHOOK_URL),
    databaseUrl:
      process.env.DATABASE_URL ||
      "postgres://retail:retail@127.0.0.1:55432/retail_orchestrator",
    redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:56379",
    s3,
    s3Public: { ...s3, endpoint: process.env.S3_PUBLIC_ENDPOINT || masterPublicBaseUrl },
    retailMart
  };
}

export function normalizeDingTalkWebhookUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || /REPLACE_BEFORE_GO_LIVE/i.test(normalized)) return undefined;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("invalid_dingtalk_webhook");
  }
  if (
    url.protocol !== "https:"
    || url.hostname !== "oapi.dingtalk.com"
    || url.pathname !== "/robot/send"
    || !url.searchParams.get("access_token")
  ) {
    throw new Error("invalid_dingtalk_webhook");
  }
  return url.toString();
}

function parseAllowedOrigins(value: string | undefined, masterPublicBaseUrl: string): string[] {
  const configured = value?.split(",").map((item) => item.trim()).filter(Boolean) || [];
  let publicOrigin: string | undefined;
  try {
    publicOrigin = new URL(masterPublicBaseUrl).origin;
  } catch {
    publicOrigin = undefined;
  }
  return [...new Set([...(publicOrigin ? [publicOrigin] : []), ...configured])];
}
