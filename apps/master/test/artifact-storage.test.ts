import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { verifyArtifactStorageEvidence } from "../src/repositories/artifacts.js";

const artifact = {
  artifactId: "artifact-food",
  bucket: "raw-artifacts",
  objectKey: "run/task/products.raw.jsonl",
  sizeBytes: 128,
  checksumSha256: "a".repeat(64)
};

test("object storage HEAD evidence verifies size, uploader checksum and ETag", async () => {
  const evidence = await verifyArtifactStorageEvidence({
    statObject: async () => ({
      size: 128,
      etag: '"etag-123"',
      lastModified: new Date("2026-07-15T00:00:00.000Z"),
      metaData: { "x-amz-meta-checksum-sha256": "a".repeat(64) }
    })
  } as any, artifact);

  assert.deepEqual(evidence, {
    sizeBytes: 128,
    etag: "etag-123",
    checksumSha256: "a".repeat(64),
    checksumSource: "object-metadata"
  });
});

test("object storage evidence blocks a missing object", async () => {
  await assert.rejects(
    verifyArtifactStorageEvidence({ statObject: async () => { throw new Error("NoSuchKey"); } } as any, artifact),
    /artifact_object_unavailable:artifact-food/
  );
});

test("object storage evidence blocks size and checksum mismatches", async () => {
  await assert.rejects(
    verifyArtifactStorageEvidence({
      statObject: async () => ({ size: 127, etag: "etag", lastModified: new Date(), metaData: {} })
    } as any, artifact),
    /artifact_size_mismatch:artifact-food/
  );

  await assert.rejects(
    verifyArtifactStorageEvidence({
      statObject: async () => ({
        size: 128,
        etag: "etag",
        lastModified: new Date(),
        metaData: { checksumSha256: "b".repeat(64) }
      })
    } as any, artifact),
    /artifact_checksum_mismatch:artifact-food/
  );
});

test("object storage evidence requires a registered SHA-256 and never treats ETag as a content checksum", async () => {
  await assert.rejects(
    verifyArtifactStorageEvidence({
      statObject: async () => ({ size: 128, etag: "etag", lastModified: new Date(), metaData: {} })
    } as any, { ...artifact, checksumSha256: undefined }),
    /artifact_checksum_missing:artifact-food/
  );

  await assert.rejects(
    verifyArtifactStorageEvidence({
      statObject: async () => ({ size: 128, etag: "etag-only", lastModified: new Date(), metaData: {} }),
      getObject: async () => Readable.from(Buffer.from("tampered-content"))
    } as any, artifact),
    /artifact_checksum_mismatch:artifact-food/
  );
});

test("object storage evidence hashes object content when checksum metadata is absent", async () => {
  const content = Buffer.from("complete raw jsonl content");
  const checksumSha256 = createHash("sha256").update(content).digest("hex");
  const evidence = await verifyArtifactStorageEvidence({
    statObject: async () => ({ size: content.length, etag: "etag-raw", lastModified: new Date(), metaData: {} }),
    getObject: async () => Readable.from(content)
  } as any, { ...artifact, sizeBytes: content.length, checksumSha256 });

  assert.equal(evidence.checksumSha256, checksumSha256);
  assert.equal(evidence.checksumSource, "content-sha256");
});

test("frozen evidence reads the exact object version instead of the latest key", async () => {
  const calls: unknown[][] = [];
  const evidence = await verifyArtifactStorageEvidence({
    statObject: async (...args: unknown[]) => {
      calls.push(args);
      return {
        size: 128,
        etag: "versioned-etag",
        versionId: "version-17",
        lastModified: new Date(),
        metaData: { checksumSha256: "a".repeat(64) }
      };
    }
  } as any, { ...artifact, storageVersionId: "version-17" });

  assert.equal(evidence.versionId, "version-17");
  assert.deepEqual(calls[0], ["raw-artifacts", artifact.objectKey, { versionId: "version-17" }]);
});
