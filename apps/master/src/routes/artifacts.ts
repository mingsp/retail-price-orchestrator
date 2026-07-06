import type { PresignArtifactInput, RegisterArtifactInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Client } from "minio";
import type { Pool } from "pg";
import { listArtifacts, registerArtifact } from "../repositories/artifacts.js";
import { broadcastDashboard } from "../ws/dashboard-gateway.js";

export function registerArtifactRoutes(app: FastifyInstance, db: Pool, s3: Client): void {
  app.get<{ Querystring: { taskId?: string; runId?: string; storeId?: string } }>("/api/artifacts", async (request) => {
    return { artifacts: await listArtifacts(db, request.query) };
  });

  app.post<{ Body: RegisterArtifactInput }>("/api/artifacts", async (request) => {
    const artifact = await registerArtifact(db, request.body);
    broadcastDashboard({ type: "artifact.created", sentAt: new Date().toISOString(), artifact });
    return { artifact };
  });

  app.post<{ Body: PresignArtifactInput }>("/api/artifacts/presign", async (request) => {
    const expiresSeconds = request.body.expiresSeconds || 900;
    const url = await s3.presignedPutObject(request.body.bucket, request.body.objectKey, expiresSeconds);
    return { url, expiresSeconds };
  });
}
