import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readWorkerIdentity,
  buildWindowsIdentityAclArguments,
  resolveWorkerIdentity,
  writeWorkerIdentity,
  type PersistedWorkerIdentity
} from "../src/worker-identity-store.js";

const identity: PersistedWorkerIdentity = {
  workerId: "worker-mm",
  workerToken: "rwk_secret",
  masterBaseUrl: "https://retail-master.local",
  enrolledAt: "2026-07-15T00:00:00.000Z"
};

test("worker identity is atomically persisted and can be reopened", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-worker-identity-"));
  const file = path.join(root, "nested", "identity.json");

  await writeWorkerIdentity(file, identity);

  assert.deepEqual(await readWorkerIdentity(file), identity);
  assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), ["identity.json"]);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
});

test("Windows identity ACL removes inheritance and grants only system, administrators and the service account", () => {
  const args = buildWindowsIdentityAclArguments("C:\\ProgramData\\RetailRadar\\Worker\\state", true, {
    USERDOMAIN: "RETAIL",
    USERNAME: "worker-service"
  });
  assert.deepEqual(args, [
    "C:\\ProgramData\\RetailRadar\\Worker\\state",
    "/inheritance:r",
    "/grant:r",
    "*S-1-5-18:(OI)(CI)F",
    "*S-1-5-32-544:(OI)(CI)F",
    "RETAIL\\worker-service:(OI)(CI)F"
  ]);
});

test("Windows workgroup sessions grant the local machine account instead of the unmappable workgroup name", () => {
  const args = buildWindowsIdentityAclArguments("C:\\ProgramData\\RetailRadar\\Worker\\state", false, {
    USERDOMAIN: "WORKGROUP",
    COMPUTERNAME: "DESKTOP-G4EAACD",
    USERNAME: "Administrator"
  });
  assert.equal(args.at(-1), "DESKTOP-G4EAACD\\Administrator:F");
});

test("Windows identity ACL accepts the current process SID and de-duplicates LocalSystem", () => {
  const args = buildWindowsIdentityAclArguments(
    "C:\\ProgramData\\RetailRadar\\Worker\\state",
    true,
    { USERDOMAIN: "MM", USERNAME: "MM$" },
    "*S-1-5-18"
  );
  assert.deepEqual(args, [
    "C:\\ProgramData\\RetailRadar\\Worker\\state",
    "/inheritance:r",
    "/grant:r",
    "*S-1-5-18:(OI)(CI)F",
    "*S-1-5-32-544:(OI)(CI)F"
  ]);
});

test("missing identity is distinct from a corrupt identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "retail-worker-identity-"));
  const missing = path.join(root, "missing.json");
  assert.equal(await readWorkerIdentity(missing), undefined);

  const corrupt = path.join(root, "corrupt.json");
  await fs.writeFile(corrupt, "{not-json", "utf8");
  await assert.rejects(() => readWorkerIdentity(corrupt), /worker_identity_corrupt/);
});

test("persisted Master-issued credentials cannot be replaced by environment identity", () => {
  assert.deepEqual(resolveWorkerIdentity(identity, {
    workerId: "worker-jl",
    workerToken: "rwk_override",
    masterBaseUrl: "https://master-override.local"
  }), {
    workerId: identity.workerId,
    workerToken: identity.workerToken,
    masterBaseUrl: "https://master-override.local",
    enrolledAt: identity.enrolledAt
  });
});

test("explicit credentials remain available only when no persisted identity exists", () => {
  const resolved = resolveWorkerIdentity(undefined, {
    workerId: "worker-jl",
    workerToken: "rwk_override",
    masterBaseUrl: "https://master-override.local"
  });
  assert.equal(resolved?.workerId, "worker-jl");
  assert.equal(resolved?.workerToken, "rwk_override");
  assert.equal(resolved?.masterBaseUrl, "https://master-override.local");
  assert.match(resolved?.enrolledAt || "", /^\d{4}-\d{2}-\d{2}T/);

  assert.throws(
    () => resolveWorkerIdentity(undefined, { workerId: "worker-jl" }),
    /worker_identity_override_incomplete/
  );
});
