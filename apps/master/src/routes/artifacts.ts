import type { PresignArtifactInput, RegisterArtifactInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Client } from "minio";
import type { Pool } from "pg";
import { getArtifact, listArtifacts, registerArtifact, verifyArtifactStorageEvidence } from "../repositories/artifacts.js";
import type { DashboardEventBus } from "../dashboard-event-bus.js";
import { assertActiveTaskArtifactWriteScope } from "../repositories/task-write-guard.js";

export function registerArtifactRoutes(
  app: FastifyInstance,
  db: Pool,
  s3: Client,
  s3Public: Client,
  dashboardEvents: DashboardEventBus
): void {
  app.get<{ Querystring: { taskId?: string; runId?: string; storeId?: string } }>("/api/artifacts", async (request) => {
    return { artifacts: await listArtifacts(db, request.query) };
  });

  app.post<{ Body: RegisterArtifactInput }>("/api/artifacts", async (request, reply) => {
    try {
      await assertActiveTaskArtifactWriteScope(db, request.body);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
    let storage;
    try {
      storage = await verifyArtifactStorageEvidence(s3, {
        artifactId: "pending-registration",
        bucket: request.body.bucket,
        objectKey: request.body.objectKey,
        sizeBytes: request.body.sizeBytes,
        checksumSha256: request.body.checksumSha256,
        storageVersionId: undefined
      });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
    if (!storage.versionId) return reply.code(409).send({ error: "artifact_version_missing" });
    const artifact = await registerArtifact(db, { ...request.body, storageVersionId: storage.versionId });
    dashboardEvents.emit({ type: "artifact.created", sentAt: new Date().toISOString(), artifact });
    return { artifact };
  });

  app.post<{ Body: PresignArtifactInput }>("/api/artifacts/presign", async (request, reply) => {
    try {
      await assertActiveTaskArtifactWriteScope(db, request.body);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
    const expiresSeconds = request.body.expiresSeconds || 900;
    const url = await s3Public.presignedPutObject(request.body.bucket, request.body.objectKey, expiresSeconds);
    return { url, expiresSeconds };
  });

  app.get<{ Params: { artifactId: string } }>(
    "/api/artifacts/:artifactId/content",
    {},
    async (request, reply) => {
      const artifact = await getArtifact(db, request.params.artifactId);
      if (!artifact) return reply.code(404).send({ error: "artifact_not_found" });
      if (artifact.kind !== "screenshot") return reply.code(400).send({ error: "artifact_preview_not_supported" });
      const stream = await s3.getObject(
        artifact.bucket,
        artifact.objectKey,
        artifact.storageVersionId ? { versionId: artifact.storageVersionId } : undefined
      );
      reply.header("Cache-Control", "private, max-age=60");
      reply.type(artifact.contentType || "image/png");
      return reply.send(stream);
    }
  );
}
