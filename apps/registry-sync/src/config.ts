export interface RegistrySyncConfig {
  statePath: string;
  hmacKey: string;
  masterBaseUrl: string;
  masterToken: string;
  mode: "dry_run" | "publish";
  allowPublish: boolean;
  writebackEnabled: boolean;
}

export function loadRegistrySyncConfig(environment = process.env): RegistrySyncConfig {
  const statePath = required(environment.REGISTRY_STATE_PATH, "REGISTRY_STATE_PATH");
  const hmacKey = required(environment.REGISTRY_ACCOUNT_HMAC_KEY || environment.ACCOUNT_PHONE_HMAC_KEY, "REGISTRY_ACCOUNT_HMAC_KEY");
  if (hmacKey.length < 32) throw new Error("registry_hmac_key_too_short");
  const masterBaseUrl = required(environment.MASTER_BASE_URL, "MASTER_BASE_URL").replace(/\/$/, "");
  const url = new URL(masterBaseUrl);
  if (url.protocol !== "https:") throw new Error("registry_master_url_must_be_https");
  const mode = environment.REGISTRY_SYNC_MODE === "publish" ? "publish" : "dry_run";
  const masterToken = required(environment.REGISTRY_SYNC_TOKEN || environment.MASTER_REGISTRY_SYNC_TOKEN, "REGISTRY_SYNC_TOKEN");
  const allowPublish = environment.REGISTRY_ALLOW_PUBLISH === "true";
  if (mode === "publish" && !allowPublish) throw new Error("registry_publish_not_enabled");
  const writebackEnabled = environment.REGISTRY_WRITEBACK_ENABLED === "true";
  if (writebackEnabled && (mode !== "publish" || !allowPublish)) throw new Error("registry_writeback_requires_publish");
  return { statePath, hmacKey, masterBaseUrl, masterToken, mode, allowPublish, writebackEnabled };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`missing_environment:${name}`);
  return normalized;
}
