import { createHash, randomUUID } from "node:crypto";
import type { AccountSnapshot, CategoryTaskRecord } from "@retail-orchestrator/shared";
import WebSocket from "ws";
import type { WorkerConfig } from "./config.js";
import { presignArtifact, registerArtifact } from "./master-api.js";

interface CdpPageTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export async function captureRiskScreenshot(
  config: WorkerConfig,
  task: CategoryTaskRecord,
  account: AccountSnapshot
): Promise<string | undefined> {
  const endpoint = account.cdpEndpoint || `http://127.0.0.1:${account.cdpPort}`;
  const response = await fetch(new URL("/json/list", endpoint));
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`);
  const targets = await response.json() as CdpPageTarget[];
  const target = targets.find((item) => item.type === "page" && item.url?.includes("waimai.meituan.com"));
  if (!target?.webSocketDebuggerUrl) return undefined;

  const data = await capturePagePng(target.webSocketDebuggerUrl);
  const buffer = Buffer.from(data, "base64");
  const objectKey = [task.storeId, task.runId, task.taskId, `risk-${Date.now()}-${randomUUID()}.png`].join("/");
  const presign = await presignArtifact(config, "screenshots", objectKey, task, account);
  const upload = await fetch(presign.url, { method: "PUT", body: buffer });
  if (!upload.ok) throw new Error(`risk screenshot upload failed: ${upload.status}`);
  const artifact = await registerArtifact(config, {
    taskId: task.taskId,
    runId: task.runId,
    storeId: task.storeId,
    workerId: config.worker.workerId,
    accountId: account.accountId,
    profileId: account.profileId,
    kind: "screenshot",
    bucket: "screenshots",
    objectKey,
    contentType: "image/png",
    sizeBytes: buffer.byteLength,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
    metadata: { source: "automatic-risk-capture", cdpPort: account.cdpPort }
  });
  return artifact.artifactId;
}

function capturePagePng(wsUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("CDP screenshot timeout"));
    }, 5_000);
    timer.unref();
    const finish = (error?: Error, data?: string) => {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else if (data) resolve(data);
      else reject(new Error("CDP screenshot returned no data"));
    };
    socket.once("open", () => socket.send(JSON.stringify({
      id,
      method: "Page.captureScreenshot",
      params: { format: "png", fromSurface: true, captureBeyondViewport: false }
    })));
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id !== id) return;
      if (message.error) finish(new Error(message.error.message || "CDP screenshot failed"));
      else finish(undefined, message.result?.data);
    });
    socket.once("error", (error) => finish(error));
  });
}
