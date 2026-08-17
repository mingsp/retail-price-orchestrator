import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AccountSnapshot, CdpCommandRecord, CdpEndpointSnapshot } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { resolveProfilePath } from "./cdp-launcher.js";

interface PersistedCdpRuntimeState {
  version: 1;
  workerId: string;
  updatedAt: string;
  endpoints: CdpEndpointSnapshot[];
  accounts: AccountSnapshot[];
}

export interface CdpRuntimeInventory {
  cdpEndpoints: CdpEndpointSnapshot[];
  accounts: AccountSnapshot[];
}

export async function readCdpRuntimeInventory(config: WorkerConfig): Promise<CdpRuntimeInventory> {
  const persisted = await readPersistedState(config);
  return {
    cdpEndpoints: mergeByKey(
      config.cdpEndpoints,
      persisted?.endpoints || [],
      (endpoint) => endpoint.endpointId || `${config.worker.workerId}:${endpoint.port}`
    ),
    accounts: mergeByKey(config.accounts, persisted?.accounts || [], (account) => account.accountId)
  };
}

export async function recordCdpCommandResult(
  config: WorkerConfig,
  command: CdpCommandRecord,
  endpoint: CdpEndpointSnapshot
): Promise<void> {
  const inventory = await readCdpRuntimeInventory(config);
  const normalizedEndpoint: CdpEndpointSnapshot = {
    ...endpoint,
    endpointId: endpoint.endpointId || `${config.worker.workerId}:${endpoint.port}`,
    workerId: config.worker.workerId
  };
  const endpoints = mergeByKey(
    inventory.cdpEndpoints,
    [normalizedEndpoint],
    (item) => item.endpointId || `${config.worker.workerId}:${item.port}`
  );
  const observedAccount = accountFromCommand(config, command, normalizedEndpoint);
  const accounts = observedAccount
    ? mergeByKey(inventory.accounts, [observedAccount], (account) => account.accountId)
    : inventory.accounts;
  await writePersistedState(config, {
    version: 1,
    workerId: config.worker.workerId,
    updatedAt: new Date().toISOString(),
    endpoints,
    accounts
  });
}

export function applyEndpointHealthToAccounts(
  accounts: AccountSnapshot[],
  endpoints: CdpEndpointSnapshot[]
): AccountSnapshot[] {
  const byAccount = new Map(endpoints.filter((endpoint) => endpoint.accountId).map((endpoint) => [endpoint.accountId!, endpoint]));
  return accounts.map((account) => {
    const endpoint = byAccount.get(account.accountId);
    if (!endpoint) return account;
    if (endpoint.status === "retired") {
      return { ...account, status: "retired", profileStatus: "retired" };
    }
    if (endpoint.status === "profile_risk") {
      return { ...account, status: "account_blocked", riskLevel: "high", profileStatus: "profile_risk" };
    }
    if (endpoint.status === "manual_required") {
      return { ...account, status: "manual_required", riskLevel: account.riskLevel === "normal" ? "watch" : account.riskLevel };
    }
    return account;
  });
}

function accountFromCommand(
  config: WorkerConfig,
  command: CdpCommandRecord,
  endpoint: CdpEndpointSnapshot
): AccountSnapshot | undefined {
  if (!command.accountId) return undefined;
  const retired = endpoint.status === "retired";
  const profileRisk = endpoint.status === "profile_risk";
  return {
    accountId: command.accountId,
    displayName: command.accountDisplayName || command.accountId,
    maskedLogin: command.maskedLogin,
    status: retired ? "retired" : profileRisk ? "account_blocked" : "safe",
    riskLevel: profileRisk ? "high" : "normal",
    profileId: command.profileId,
    profileStatus: retired ? "retired" : profileRisk ? "profile_risk" : "safe",
    profilePath: resolveProfilePath(config, command),
    cdpPort: command.port,
    cdpEndpoint: endpoint.endpointUrl || `http://127.0.0.1:${command.port}`,
    currentStoreId: command.targetStoreId,
    currentStoreName: command.targetStoreName
  };
}

async function readPersistedState(config: WorkerConfig): Promise<PersistedCdpRuntimeState | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(config.cdpStateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let state: PersistedCdpRuntimeState;
  try {
    state = JSON.parse(raw.replace(/^\uFEFF/, "")) as PersistedCdpRuntimeState;
  } catch {
    throw new Error("cdp_runtime_state_invalid_json");
  }
  if (
    state.version !== 1 ||
    state.workerId !== config.worker.workerId ||
    !Array.isArray(state.endpoints) ||
    !Array.isArray(state.accounts)
  ) {
    throw new Error("cdp_runtime_state_invalid");
  }
  return state;
}

async function writePersistedState(config: WorkerConfig, state: PersistedCdpRuntimeState): Promise<void> {
  const directory = path.dirname(config.cdpStateFile);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(config.cdpStateFile)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, config.cdpStateFile);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

function mergeByKey<T>(base: T[], updates: T[], keyOf: (item: T) => string): T[] {
  const merged = new Map(base.map((item) => [keyOf(item), item]));
  for (const item of updates) merged.set(keyOf(item), item);
  return [...merged.values()];
}
