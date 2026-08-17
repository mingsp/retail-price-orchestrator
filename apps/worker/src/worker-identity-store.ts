import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PersistedWorkerIdentity {
  workerId: string;
  workerToken: string;
  masterBaseUrl: string;
  enrolledAt: string;
}

export interface WorkerIdentityOverrides {
  workerId?: string;
  workerToken?: string;
  masterBaseUrl?: string;
}

export async function readWorkerIdentity(filePath: string): Promise<PersistedWorkerIdentity | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return validateWorkerIdentity(JSON.parse(raw) as unknown);
  } catch (error) {
    throw new Error("worker_identity_corrupt", { cause: error });
  }
}

export async function writeWorkerIdentity(filePath: string, identity: PersistedWorkerIdentity): Promise<void> {
  const validated = validateWorkerIdentity(identity);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  await protectWorkerIdentityDirectory(directory);
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
    if (process.platform === "win32") await applyWindowsIdentityAcl(filePath, false);
    else await fs.chmod(filePath, 0o600);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function buildWindowsIdentityAclArguments(
  targetPath: string,
  isDirectory: boolean,
  env: NodeJS.ProcessEnv = process.env,
  currentPrincipal?: string
): string[] {
  const accountDomain = env.USERDOMAIN?.toUpperCase() === "WORKGROUP"
    ? env.COMPUTERNAME
    : env.USERDOMAIN;
  const account = accountDomain && env.USERNAME
    ? `${accountDomain}\\${env.USERNAME}`
    : env.USERNAME || "SYSTEM";
  const suffix = isDirectory ? ":(OI)(CI)F" : ":F";
  const grants = ["*S-1-5-18", "*S-1-5-32-544", currentPrincipal || account]
    .filter((principal, index, values) => values.indexOf(principal) === index)
    .map((principal) => `${principal}${suffix}`);
  return [targetPath, "/inheritance:r", "/grant:r", ...grants];
}

async function protectWorkerIdentityDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") {
    await applyWindowsIdentityAcl(directory, true);
    return;
  }
  await fs.chmod(directory, 0o700);
}

async function applyWindowsIdentityAcl(targetPath: string, isDirectory: boolean): Promise<void> {
  const currentPrincipal = await resolveWindowsCurrentPrincipal();
  await execFileAsync(
    "icacls.exe",
    buildWindowsIdentityAclArguments(targetPath, isDirectory, process.env, currentPrincipal),
    { windowsHide: true }
  );
}

async function resolveWindowsCurrentPrincipal(): Promise<string> {
  const { stdout } = await execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
  const sid = stdout.match(/S-\d-(?:\d+-)+\d+/i)?.[0];
  if (!sid) throw new Error("windows_current_identity_sid_unavailable");
  return `*${sid.toUpperCase()}`;
}

export function resolveWorkerIdentity(
  persisted: PersistedWorkerIdentity | undefined,
  overrides: WorkerIdentityOverrides
): PersistedWorkerIdentity | undefined {
  if (persisted) {
    return validateWorkerIdentity({
      ...persisted,
      masterBaseUrl: overrides.masterBaseUrl || persisted.masterBaseUrl
    });
  }
  const hasIdentityOverride = Boolean(overrides.workerId || overrides.workerToken);
  if (hasIdentityOverride && (!overrides.workerId || !overrides.workerToken)) {
    throw new Error("worker_identity_override_incomplete");
  }
  if (overrides.workerId && overrides.workerToken) {
    return validateWorkerIdentity({
      workerId: overrides.workerId,
      workerToken: overrides.workerToken,
      masterBaseUrl: overrides.masterBaseUrl,
      enrolledAt: new Date().toISOString()
    });
  }
  return undefined;
}

function validateWorkerIdentity(value: unknown): PersistedWorkerIdentity {
  if (!value || typeof value !== "object") throw new Error("invalid_worker_identity");
  const record = value as Record<string, unknown>;
  const workerId = requiredString(record.workerId);
  const workerToken = requiredString(record.workerToken);
  const masterBaseUrl = requiredString(record.masterBaseUrl);
  const enrolledAt = requiredString(record.enrolledAt);
  const url = new URL(masterBaseUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("invalid_master_url");
  if (Number.isNaN(Date.parse(enrolledAt))) throw new Error("invalid_enrolled_at");
  return { workerId, workerToken, masterBaseUrl: url.toString().replace(/\/$/, ""), enrolledAt };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("required_identity_field_missing");
  return value.trim();
}
