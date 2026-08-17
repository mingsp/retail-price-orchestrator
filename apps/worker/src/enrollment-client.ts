import os from "node:os";
import path from "node:path";
import type { RemoteDesktopSnapshot, WorkerEnrollmentResult } from "@retail-orchestrator/shared";
import {
  readWorkerIdentity,
  resolveWorkerIdentity,
  writeWorkerIdentity,
  type PersistedWorkerIdentity
} from "./worker-identity-store.js";

interface EnrollmentResponse {
  enrollment: WorkerEnrollmentResult;
}

export async function prepareWorkerIdentity(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<PersistedWorkerIdentity> {
  const identityFile = env.WORKER_IDENTITY_FILE || path.resolve(".runtime", "worker-identity.json");
  const persisted = await readWorkerIdentity(identityFile);
  const legacyToken = env.ALLOW_LEGACY_WORKER_SHARED_TOKEN === "true"
    && env.WORKER_SHARED_TOKEN
    && env.WORKER_SHARED_TOKEN !== "change-me"
    ? env.WORKER_SHARED_TOKEN
    : undefined;
  const resolved = resolveWorkerIdentity(persisted, {
    workerId: env.WORKER_TOKEN || legacyToken ? env.WORKER_ID : undefined,
    workerToken: env.WORKER_TOKEN || legacyToken,
    masterBaseUrl: env.MASTER_BASE_URL
  });
  if (resolved) return resolved;

  const enrollmentToken = env.WORKER_ENROLLMENT_TOKEN;
  if (!enrollmentToken) throw new Error("worker_not_enrolled");
  const masterBaseUrl = (env.MASTER_BASE_URL || "http://127.0.0.1:17890").replace(/\/$/, "");
  const response = await fetchImpl(new URL("/api/workers/enroll", masterBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enrollmentToken,
      machineLabel: env.WORKER_MACHINE_LABEL || os.hostname(),
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()} ${os.arch()}`,
      agentVersion: "0.1.0",
      networkMode: env.WORKER_NETWORK_MODE || "unknown",
      capabilities: ["chrome_cdp", "local_artifacts", "manual_verification", "s3_upload"],
      remoteDesktop: readRemoteDesktop(env)
    })
  });
  if (!response.ok) throw new Error(`worker_enrollment_failed:${response.status}:${await response.text()}`);
  const body = await response.json() as EnrollmentResponse;
  const identity: PersistedWorkerIdentity = body.enrollment;
  await writeWorkerIdentity(identityFile, identity);
  return identity;
}

function readRemoteDesktop(env: NodeJS.ProcessEnv): RemoteDesktopSnapshot {
  const provider = env.WORKER_REMOTE_DESKTOP_PROVIDER;
  return {
    provider: provider === "rustdesk" || provider === "rdp" || provider === "screen_sharing" ? provider : "none",
    target: env.WORKER_REMOTE_DESKTOP_TARGET || undefined,
    status: provider && provider !== "none" && env.WORKER_REMOTE_DESKTOP_TARGET ? "ready" : "unknown"
  };
}
