import type {
  ArtifactRecord,
  CategoryTaskRecord,
  PresignArtifactResult,
  RegisterArtifactInput,
  RiskEventPayload,
  TaskStatus,
  UpdateCategoryTaskInput
} from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";

export async function updateTask(
  config: WorkerConfig,
  taskId: string,
  update: UpdateCategoryTaskInput
): Promise<CategoryTaskRecord> {
  const data = await request<{ task: CategoryTaskRecord }>(config, `/api/tasks/${taskId}`, {
    method: "PATCH",
    body: update
  });
  return data.task;
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
  await request(config, "/api/risk-events", {
    method: "POST",
    body: event
  });
}

export async function presignArtifact(
  config: WorkerConfig,
  bucket: string,
  objectKey: string
): Promise<PresignArtifactResult> {
  return request<PresignArtifactResult>(config, "/api/artifacts/presign", {
    method: "POST",
    body: { bucket, objectKey, expiresSeconds: 900 }
  });
}

export async function registerArtifact(config: WorkerConfig, input: RegisterArtifactInput): Promise<ArtifactRecord> {
  const data = await request<{ artifact: ArtifactRecord }>(config, "/api/artifacts", {
    method: "POST",
    body: input
  });
  return data.artifact;
}

async function request<T>(
  config: WorkerConfig,
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(new URL(path, config.masterBaseUrl), {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}
