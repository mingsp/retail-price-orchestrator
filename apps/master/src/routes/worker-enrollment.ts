import type {
  CreateWorkerEnrollmentTokenInput,
  WorkerEnrollmentRequest
} from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  createWorkerEnrollmentToken,
  enrollWorker,
  revokeWorkerCredentials,
  rotateWorkerCredential
} from "../repositories/worker-enrollment.js";
import { operatorWriteGuard } from "../operator-auth.js";

export function registerWorkerEnrollmentRoutes(
  app: FastifyInstance,
  db: Pool,
  masterPublicBaseUrl: string,
  operatorToken?: string
): void {
  app.post<{ Body: CreateWorkerEnrollmentTokenInput }>("/api/worker-enrollment-tokens", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    try {
      return { enrollment: await createWorkerEnrollmentToken(db, request.body) };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: WorkerEnrollmentRequest }>("/api/workers/enroll", async (request, reply) => {
    try {
      return { enrollment: await enrollWorker(db, request.body, masterPublicBaseUrl) };
    } catch (error) {
      return reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Params: { workerId: string } }>("/api/workers/:workerId/credentials/rotate", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    try {
      return { credential: await rotateWorkerCredential(db, request.params.workerId) };
    } catch (error) {
      const message = errorMessage(error);
      return reply.code(message === "worker_not_found" ? 404 : 409).send({ error: message });
    }
  });

  app.post<{ Params: { workerId: string } }>("/api/workers/:workerId/credentials/revoke", { preHandler: operatorWriteGuard(operatorToken) }, async (request) => {
    return { revoked: await revokeWorkerCredentials(db, request.params.workerId) };
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
