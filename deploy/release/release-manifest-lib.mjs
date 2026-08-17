import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const PLATFORMS = new Set(["windows-x64", "macos-arm64", "macos-x64"]);

export function assertHttpsUrl(value, fieldName) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${fieldName}_must_be_valid_url`);
  }
  if (url.protocol !== "https:") throw new Error(`${fieldName}_must_use_https`);
  if (url.username || url.password) throw new Error(`${fieldName}_must_not_embed_credentials`);
  return url.toString();
}

export function createSignedReleaseManifest(payload, privateKeyPem, keyId) {
  const validatedPayload = validatePayload(payload);
  if (typeof keyId !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
    throw new Error("release_key_id_invalid");
  }
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("release_private_key_must_be_ed25519");
  const envelope = { schemaVersion: 2, keyId, payload: validatedPayload };
  const signature = sign(null, Buffer.from(JSON.stringify(envelope)), privateKey).toString("base64");
  return { ...envelope, signature: { algorithm: "Ed25519", value: signature } };
}

export function verifySignedReleaseManifest(manifest, publicKeyPem, expectedKeyId) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("release_manifest_invalid");
  if (manifest.schemaVersion !== 2) throw new Error("release_manifest_schema_unsupported");
  if (typeof manifest.keyId !== "string" || manifest.keyId !== expectedKeyId) throw new Error("release_key_id_mismatch");
  if (manifest.signature?.algorithm !== "Ed25519" || typeof manifest.signature?.value !== "string") {
    throw new Error("release_signature_invalid");
  }
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("release_public_key_must_be_ed25519");
  const envelope = { schemaVersion: manifest.schemaVersion, keyId: manifest.keyId, payload: manifest.payload };
  const signature = Buffer.from(manifest.signature.value, "base64");
  if (signature.length !== 64 || !verify(null, Buffer.from(JSON.stringify(envelope)), publicKey, signature)) {
    throw new Error("release_signature_verification_failed");
  }
  return validatePayload(manifest.payload);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("release_payload_invalid");
  if (!SEMVER.test(String(payload.version))) throw new Error("release_version_invalid");
  if (!SEMVER.test(String(payload.minimumMasterVersion))) throw new Error("minimum_master_version_invalid");
  if (Number.isNaN(Date.parse(String(payload.generatedAt)))) throw new Error("release_generated_at_invalid");
  if (!Array.isArray(payload.artifacts) || payload.artifacts.length === 0) throw new Error("release_artifacts_required");
  const platforms = new Set();
  const artifacts = payload.artifacts.map((artifact) => {
    if (!artifact || typeof artifact !== "object") throw new Error("release_artifact_invalid");
    if (!PLATFORMS.has(artifact.platform) || platforms.has(artifact.platform)) throw new Error("release_artifact_platform_invalid");
    platforms.add(artifact.platform);
    if (!SHA256.test(String(artifact.sha256))) throw new Error("release_artifact_sha256_invalid");
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) throw new Error("release_artifact_size_invalid");
    return {
      platform: artifact.platform,
      url: assertHttpsUrl(artifact.url, "release_artifact_url"),
      sha256: String(artifact.sha256).toLowerCase(),
      sizeBytes: artifact.sizeBytes
    };
  });
  return {
    version: String(payload.version),
    minimumMasterVersion: String(payload.minimumMasterVersion),
    generatedAt: new Date(String(payload.generatedAt)).toISOString(),
    artifacts
  };
}
