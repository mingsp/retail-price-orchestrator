import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createSignedReleaseManifest, verifySignedReleaseManifest } from "./release-manifest-lib.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const payload = {
  version: "1.2.3",
  minimumMasterVersion: "1.0.0",
  generatedAt: "2026-07-15T00:00:00.000Z",
  artifacts: [{
    platform: "windows-x64",
    url: "https://releases.example.test/worker.zip",
    sha256: "a".repeat(64),
    sizeBytes: 42
  }]
};

test("Ed25519 signed release manifest verifies", () => {
  const manifest = createSignedReleaseManifest(payload, privatePem, "prod-2026");
  assert.deepEqual(verifySignedReleaseManifest(manifest, publicPem, "prod-2026"), payload);
});

test("manifest payload tampering is rejected", () => {
  const manifest = createSignedReleaseManifest(payload, privatePem, "prod-2026");
  manifest.payload.version = "9.9.9";
  assert.throws(() => verifySignedReleaseManifest(manifest, publicPem, "prod-2026"), /signature_verification_failed/);
});

test("wrong key id and non-HTTPS artifacts are rejected", () => {
  const manifest = createSignedReleaseManifest(payload, privatePem, "prod-2026");
  assert.throws(() => verifySignedReleaseManifest(manifest, publicPem, "other-key"), /key_id_mismatch/);
  assert.throws(() => createSignedReleaseManifest({
    ...payload,
    artifacts: [{ ...payload.artifacts[0], url: "http://releases.example.test/worker.zip" }]
  }, privatePem, "prod-2026"), /must_use_https/);
});

test("manifest CLI accepts the pnpm argument separator", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "retail-radar-manifest-cli-"));
  try {
    const privatePath = resolve(root, "private.pem");
    const artifactPath = resolve(root, "worker.zip");
    const outputPath = resolve(root, "manifest.json");
    await writeFile(privatePath, privatePem);
    await writeFile(artifactPath, "signed fixture\n");
    const result = await run(process.execPath, [
      "deploy/release/build-release-manifest.mjs", "--",
      "--version", "1.2.3",
      "--minimum-master-version", "1.0.0",
      "--base-url", "https://releases.example.test/worker/1.2.3",
      "--artifact", `windows-x64=${artifactPath}`,
      "--output", outputPath,
      "--private-key", privatePath,
      "--key-id", "prod-2026"
    ]);
    assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`.trim());
    const manifest = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(manifest.payload.version, "1.2.3");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise({ code, stdout, stderr }));
  });
}
