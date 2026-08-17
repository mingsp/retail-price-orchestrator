import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Client } from "minio";
import { freezeDelivery, getDelivery, listDeliveries } from "../repositories/deliveries.js";
import { exportDeliveryWorkbook } from "../repositories/business-export.js";

export function registerDeliveryRoutes(app: FastifyInstance, db: Pool, s3: Client, s3Public: Client): void {
  app.get("/api/deliveries", async () => ({ deliveries: await listDeliveries(db) }));
  app.post<{ Params: { runId: string }; Body: { minUserFinalPriceCoverage?: number } }>(
    "/api/deliveries/:runId/freeze",
    async (request, reply) => {
      const result = await freezeDelivery(db, s3, request.params.runId, request.body?.minUserFinalPriceCoverage);
      if (result.blockers.length) return reply.code(409).send({ error: "delivery_not_ready", blockers: result.blockers });
      return result;
    }
  );
  app.post<{ Params: { runId: string } }>("/api/deliveries/:runId/export", async (request, reply) => {
    try {
      const result = await exportDeliveryWorkbook(db, s3, request.params.runId);
      const url = await s3Public.presignedGetObject(
        result.artifact.bucket,
        result.artifact.objectKey,
        900,
        result.artifact.storageVersionId ? { versionId: result.artifact.storageVersionId } : undefined
      );
      return { ...result, url, expiresSeconds: 900 };
    } catch (error) {
      return reply.code(409).send({ error: "delivery_export_blocked", message: error instanceof Error ? error.message : String(error) });
    }
  });
  app.get<{ Params: { runId: string } }>("/api/deliveries/:runId/download", async (request, reply) => {
    const delivery = await getDelivery(db, request.params.runId);
    if (!delivery?.exportArtifactId) return reply.code(404).send({ error: "delivery_export_not_found" });
    const result = await db.query(`SELECT bucket, object_key, storage_version_id FROM artifacts WHERE artifact_id = $1`, [delivery.exportArtifactId]);
    if (!result.rows[0]) return reply.code(404).send({ error: "delivery_export_not_found" });
    const url = await s3Public.presignedGetObject(
      result.rows[0].bucket,
      result.rows[0].object_key,
      900,
      result.rows[0].storage_version_id ? { versionId: result.rows[0].storage_version_id } : undefined
    );
    return { url, expiresSeconds: 900 };
  });
}
