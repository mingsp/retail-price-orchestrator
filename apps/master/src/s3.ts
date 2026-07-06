import { Client } from "minio";
import type { MasterConfig } from "./config.js";

export function createS3Client(config: MasterConfig["s3"]): Client {
  const endpoint = new URL(config.endpoint);
  return new Client({
    endPoint: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === "https:" ? 443 : 80,
    useSSL: endpoint.protocol === "https:",
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
    pathStyle: config.forcePathStyle
  });
}

export async function ensureBuckets(client: Client): Promise<void> {
  for (const bucket of ["raw-artifacts", "exports", "screenshots", "logs"]) {
    const exists = await client.bucketExists(bucket).catch(() => false);
    if (!exists) await client.makeBucket(bucket, "us-east-1");
  }
}

