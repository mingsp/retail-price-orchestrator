import type { InternalRegistryRecord } from "./record-mapper.js";

export interface RegistryBatchRequest {
  provider: "dingtalk_aitable";
  sourceBaseId: string;
  schemaHash: string;
  readComplete: true;
  records: InternalRegistryRecord[];
}

export interface MasterRegistryClient {
  preflight(batch: RegistryBatchRequest): Promise<Record<string, unknown>>;
  publish(batch: RegistryBatchRequest): Promise<Record<string, unknown>>;
}

export function createMasterRegistryClient(baseUrl: string, token: string): MasterRegistryClient {
  const request = async (path: string, batch: RegistryBatchRequest) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-retail-registry-sync-token": token
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(30_000)
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok && !Array.isArray(body.issues)) {
      throw new Error(`master_registry_request_failed:${response.status}:${safeErrorCode(body)}`);
    }
    if (!response.ok) return { ...body, requestRejected: true, httpStatus: response.status };
    return body;
  };
  return {
    preflight: (batch) => request("/api/registry-sync/preflight", batch),
    publish: (batch) => request("/api/registry-sync/publish", batch)
  };
}

function safeErrorCode(body: Record<string, unknown>): string {
  const error = typeof body.error === "string" ? body.error : "unknown";
  return /^[a-z0-9_:.-]{1,120}$/i.test(error) ? error : "redacted";
}
