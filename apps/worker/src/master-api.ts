import type {
  AccountSnapshot,
  ArtifactRecord,
  CdpCommandRecord,
  CategoryTaskRecord,
  CompleteCdpCommandInput,
  PresignArtifactResult,
  ProductSnapshotBatchInput,
  PriceQualityRecord,
  RegisterPriceQualityInput,
  RegisterArtifactInput,
  RiskEventPayload,
  TaskClaimInput,
  TaskClaimResult,
  TaskStatus,
  UpdateCategoryTaskInput
} from "@retail-orchestrator/shared";
import type { IngestionErrorInput } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { randomUUID } from "node:crypto";
import { LocalSpool } from "./local-spool.js";

const taskLeaseGuards = new Map<string, { owner: string; generation: number }>();
interface SpoolMutation {
  path: string;
  method: string;
  body: unknown;
}
const mutationSpools = new Map<string, LocalSpool<SpoolMutation>>();

export function bindTaskLeaseGuard(taskId: string, owner: string, generation: number): void {
  taskLeaseGuards.set(taskId, { owner, generation });
}

export function clearTaskLeaseGuard(taskId: string): void {
  taskLeaseGuards.delete(taskId);
}

export async function updateTask(
  config: WorkerConfig,
  taskId: string,
  update: UpdateCategoryTaskInput
): Promise<CategoryTaskRecord> {
  const guard = taskLeaseGuards.get(taskId);
  const data = await request<{ task: CategoryTaskRecord }>(config, `/api/worker/tasks/${taskId}`, {
    method: "PATCH",
    body: guard
      ? { ...update, expectedLeaseOwner: guard.owner, expectedLeaseGeneration: guard.generation }
      : update
  });
  return data.task;
}

export async function renewTaskLease(config: WorkerConfig, taskId: string, seconds = 120): Promise<CategoryTaskRecord> {
  const guard = taskLeaseGuards.get(taskId);
  if (!guard) throw new Error("task lease guard not bound");
  const data = await request<{ task: CategoryTaskRecord }>(config, `/api/worker/tasks/${taskId}/lease/renew`, {
    method: "POST",
    body: {
      expectedLeaseOwner: guard.owner,
      expectedLeaseGeneration: guard.generation,
      seconds
    }
  });
  return data.task;
}

export async function claimTask(config: WorkerConfig, input: TaskClaimInput): Promise<TaskClaimResult> {
  return request<TaskClaimResult>(config, "/api/tasks/claim", {
    method: "POST",
    body: input
  });
}

export async function setTaskStatus(
  config: WorkerConfig,
  taskId: string,
  status: TaskStatus,
  extra: Omit<UpdateCategoryTaskInput, "status"> = {}
): Promise<CategoryTaskRecord> {
  return updateTask(config, taskId, { status, ...extra });
}

export async function createRiskEvent(config: WorkerConfig, event: RiskEventPayload["event"]): Promise<void> {
  const identifiedEvent = { ...event, riskId: event.riskId || randomUUID() };
  await request(config, "/api/risk-events", {
    method: "POST",
    body: identifiedEvent,
    spoolKey: `risk:${identifiedEvent.riskId}`
  });
}

export function startMutationSpoolReplay(config: WorkerConfig): () => void {
  let running = false;
  const replay = async () => {
    if (running) return;
    running = true;
    try {
      const spool = getMutationSpool(config);
      for (const item of await spool.list()) {
        const response = await sendRequest(config, item.payload.path, {
          method: item.payload.method,
          body: item.payload.body
        }).catch(() => undefined);
        if (response?.ok) await spool.acknowledge(item.idempotencyKey);
      }
    } finally {
      running = false;
    }
  };
  void replay();
  const timer = setInterval(() => void replay(), 15_000);
  timer.unref();
  return () => clearInterval(timer);
}

export async function claimCdpCommand(config: WorkerConfig): Promise<CdpCommandRecord | undefined> {
  const data = await request<{ command?: CdpCommandRecord }>(config, "/api/cdp-commands/claim", {
    method: "POST",
    body: { workerId: config.worker.workerId }
  });
  return data.command;
}

export async function completeCdpCommand(
  config: WorkerConfig,
  commandId: string,
  input: CompleteCdpCommandInput
): Promise<CdpCommandRecord> {
  const data = await request<{ command: CdpCommandRecord }>(config, `/api/cdp-commands/${commandId}/complete`, {
    method: "POST",
    body: input
  });
  return data.command;
}

export async function presignArtifact(
  config: WorkerConfig,
  bucket: string,
  objectKey: string,
  task: Pick<CategoryTaskRecord, "taskId" | "runId" | "storeId">,
  account: Pick<AccountSnapshot, "accountId" | "profileId">
): Promise<PresignArtifactResult> {
  const guard = requiredLeaseGuard(task.taskId);
  return request<PresignArtifactResult>(config, "/api/artifacts/presign", {
    method: "POST",
    body: {
      bucket,
      objectKey,
      expiresSeconds: 900,
      taskId: task.taskId,
      runId: task.runId,
      storeId: task.storeId,
      workerId: config.worker.workerId,
      accountId: account.accountId,
      profileId: account.profileId,
      leaseOwner: guard.owner,
      leaseGeneration: guard.generation
    }
  });
}

export async function registerArtifact(config: WorkerConfig, input: RegisterArtifactInput): Promise<ArtifactRecord> {
  const guard = requiredLeaseGuard(input.taskId);
  const data = await request<{ artifact: ArtifactRecord }>(config, "/api/artifacts", {
    method: "POST",
    body: { ...input, leaseOwner: guard.owner, leaseGeneration: guard.generation }
  });
  return data.artifact;
}

export async function registerProductSnapshots(
  config: WorkerConfig,
  input: ProductSnapshotBatchInput
): Promise<{ products: number; skus: number }> {
  const taskId = input.products[0]?.taskId || input.skus[0]?.taskId;
  const guard = requiredLeaseGuard(taskId);
  return request<{ products: number; skus: number }>(config, "/api/product-snapshots/batch", {
    method: "POST",
    body: {
      ...input,
      writeWorkerId: config.worker.workerId,
      leaseOwner: guard.owner,
      leaseGeneration: guard.generation
    }
  });
}

export async function registerPriceQuality(
  config: WorkerConfig,
  input: RegisterPriceQualityInput
): Promise<PriceQualityRecord> {
  const guard = requiredLeaseGuard(input.taskId);
  const data = await request<{ quality: PriceQualityRecord }>(config, "/api/quality-checks", {
    method: "POST",
    body: { ...input, leaseOwner: guard.owner, leaseGeneration: guard.generation }
  });
  return data.quality;
}

export async function registerIngestionError(config: WorkerConfig, input: IngestionErrorInput): Promise<void> {
  const guard = requiredLeaseGuard(input.taskId);
  await request(config, "/api/ingestion-errors", {
    method: "POST",
    body: { ...input, workerId: config.worker.workerId, leaseOwner: guard.owner, leaseGeneration: guard.generation },
    spoolKey: `ingestion-error:${input.errorKey}`
  });
}

function requiredLeaseGuard(taskId: string | undefined): { owner: string; generation: number } {
  const guard = taskId ? taskLeaseGuards.get(taskId) : undefined;
  if (!guard) throw new Error("task_write_lease_required");
  return guard;
}

async function request<T>(
  config: WorkerConfig,
  path: string,
  options: { method?: string; body?: unknown; spoolKey?: string } = {}
): Promise<T> {
  let response: Response;
  try {
    response = await sendRequest(config, path, options);
  } catch (error) {
    await spoolMutation(config, path, options);
    throw error;
  }
  if (!response.ok && response.status >= 500) await spoolMutation(config, path, options);
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function sendRequest(
  config: WorkerConfig,
  path: string,
  options: { method?: string; body?: unknown }
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.masterRequestTimeoutMs);
  timer.unref();
  try {
    return await fetch(new URL(path, config.masterBaseUrl), {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${config.workerToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function spoolMutation(
  config: WorkerConfig,
  path: string,
  options: { method?: string; body?: unknown; spoolKey?: string }
): Promise<void> {
  if (!options.spoolKey || !options.body) return;
  await getMutationSpool(config).enqueue({
    idempotencyKey: options.spoolKey,
    payload: { path, method: options.method || "POST", body: options.body }
  });
}

function getMutationSpool(config: WorkerConfig): LocalSpool<SpoolMutation> {
  const existing = mutationSpools.get(config.mutationSpoolFile);
  if (existing) return existing;
  const spool = new LocalSpool<SpoolMutation>(config.mutationSpoolFile);
  mutationSpools.set(config.mutationSpoolFile, spool);
  return spool;
}
