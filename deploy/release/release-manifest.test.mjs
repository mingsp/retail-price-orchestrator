import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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
