import manifestValue from "../../../deploy/dingtalk/production-registry.schema.json" with { type: "json" };
import { loadRegistrySyncConfig } from "./config.js";
import { createDwsClient } from "./dws-client.js";
import { createMasterRegistryClient } from "./master-client.js";
import { loadRegistryRuntimeState } from "./runtime-state.js";
import { validateSchemaManifest } from "./schema-manifest.js";
import { runRegistrySync } from "./sync-runner.js";

const config = loadRegistrySyncConfig();
const manifest = validateSchemaManifest(manifestValue);
const runtimeState = await loadRegistryRuntimeState(config.statePath, manifest);
const result = await runRegistrySync({
  runtimeState,
  hmacKey: config.hmacKey,
  mode: config.mode,
  writebackEnabled: config.writebackEnabled
}, createDwsClient(), createMasterRegistryClient(config.masterBaseUrl, config.masterToken));

process.stdout.write(`${JSON.stringify({
  success: true,
  mode: result.mode,
  recordCount: result.recordCount,
  entityCounts: result.entityCounts
})}\n`);
