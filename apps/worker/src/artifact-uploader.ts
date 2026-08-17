import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AccountSnapshot, ArtifactKind, ArtifactRecord, CategoryTaskRecord } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";
import { presignArtifact, registerArtifact } from "./master-api.js";

export interface NativeOutputFiles {
  raw: string;
  categories: string;
  progress: string;
  summary: string;
  checkpoint: string;
}

export interface ArtifactUploadPlanItem {
  artifactPart: keyof NativeOutputFiles;
  kind: ArtifactKind;
  localPath: string;
  objectKey: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

export function buildNativeArtifactUploadPlan(
  task: Pick<CategoryTaskRecord, "storeId" | "runId" | "taskId">,
  runId: string,
  files: NativeOutputFiles
): ArtifactUploadPlanItem[] {
  return [
    buildArtifactPlanItem(task, runId, "raw", "raw_jsonl", files.raw),
    buildArtifactPlanItem(task, runId, "progress", "log", files.progress),
    buildArtifactPlanItem(task, runId, "checkpoint", "log", files.checkpoint),
    buildArtifactPlanItem(task, runId, "summary", "log", files.summary),
    buildArtifactPlanItem(task, runId, "categories", "log", files.categories)
  ];
}

export async function uploadArtifactPlan(
  config: WorkerConfig,
  task: Pick<CategoryTaskRecord, "taskId" | "runId" | "storeId">,
  account: Pick<AccountSnapshot, "accountId" | "profileId">,
  plan: ArtifactUploadPlanItem[]
): Promise<Partial<Record<keyof NativeOutputFiles, ArtifactRecord>>> {
  const uploaded: Partial<Record<keyof NativeOutputFiles, ArtifactRecord>> = {};

  for (const artifact of plan) {
    if (!(await exists(artifact.localPath))) continue;
    const stat = await fs.stat(artifact.localPath);
    const buffer = await fs.readFile(artifact.localPath);
    const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
    const presign = await presignArtifact(config, config.artifactBucket, artifact.objectKey, task, account);
    const response = await fetch(presign.url, { method: "PUT", body: buffer });
    if (!response.ok) {
      throw new Error(`native artifact upload failed ${response.status}: ${artifact.objectKey}`);
    }
    uploaded[artifact.artifactPart] = await registerArtifact(config, {
      taskId: task.taskId,
      runId: task.runId,
      storeId: task.storeId,
      workerId: config.worker.workerId,
      accountId: account.accountId,
      profileId: account.profileId,
      kind: artifact.kind,
      bucket: config.artifactBucket,
      objectKey: artifact.objectKey,
      contentType: artifact.contentType,
      sizeBytes: stat.size,
      checksumSha256,
      metadata: artifact.metadata
    });
  }

  return uploaded;
}

function buildArtifactPlanItem(
  task: Pick<CategoryTaskRecord, "storeId" | "runId" | "taskId">,
  runId: string,
  artifactPart: keyof NativeOutputFiles,
  kind: ArtifactKind,
  localPath: string
): ArtifactUploadPlanItem {
  return {
    artifactPart,
    kind,
    localPath,
    objectKey: buildArtifactObjectKey(task, runId, localPath),
    contentType: inferArtifactContentType(localPath),
    metadata: {
      adapter: "native-cdp",
      sourceFile: localPath,
      artifactPart
    }
  };
}

export function buildArtifactObjectKey(
  task: Pick<CategoryTaskRecord, "storeId" | "runId" | "taskId">,
  runId: string,
  localPath: string
): string {
  return [task.storeId, task.runId, task.taskId, `${runId}-${path.basename(localPath)}`].join("/");
}

function inferArtifactContentType(localPath: string): string {
  if (localPath.endsWith(".jsonl")) return "application/jsonl";
  return "application/json";
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
