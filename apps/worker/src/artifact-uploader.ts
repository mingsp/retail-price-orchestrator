import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
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
    const checksumSha256 = await hashFile(artifact.localPath);
    const presign = await presignArtifact(config, config.artifactBucket, artifact.objectKey, task, account);
    const response = await fetch(presign.url, {
      method: "PUT",
      body: createReadStream(artifact.localPath),
      duplex: "half"
    } as unknown as RequestInit & { duplex: "half" });
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
      sourceFile: path.basename(localPath),
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

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}
