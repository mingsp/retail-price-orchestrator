import assert from "node:assert/strict";
import test from "node:test";
import { assertArtifactReplayCompatible } from "../src/repositories/artifacts.js";

test("artifact registration replay is idempotent for the same checksum and version", () => {
  assert.doesNotThrow(() => assertArtifactReplayCompatible(
    { checksumSha256: "a".repeat(64), storageVersionId: "version-1" },
    { checksumSha256: "a".repeat(64), storageVersionId: "version-1" }
  ));
});

test("same object key cannot be rebound to different content", () => {
  assert.throws(
    () => assertArtifactReplayCompatible(
      { checksumSha256: "a".repeat(64), storageVersionId: "version-1" },
      { checksumSha256: "b".repeat(64), storageVersionId: "version-2" }
    ),
    /artifact_immutable_conflict/
  );
});
