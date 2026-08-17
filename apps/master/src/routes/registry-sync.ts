import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import {
  getRegistrySyncStatus,
  preflightRegistryBatch,
  publishRegistryBatch,
  RegistryBatchRejectedError,
  type RegistrySyncBatchInput
} from "../repositories/registry-sync.js";

export function registerRegistrySyncRoutes(
  app: FastifyInstance,
  db: Pool,
  expectedSchemaHash: string | undefined,
  registrySyncToken: string | undefined
): void {
  const guard = registrySyncGuard(registrySyncToken);

  app.post<{ Body: RegistrySyncBatchInput }>("/api/registry-sync/preflight", { preHandler: guard }, async (request, reply) => {
    if (!expectedSchemaHash) return reply.code(503).send({ error: "registry_sync_not_configured" });
    const validation = await preflightRegistryBatch(db, request.body, expectedSchemaHash);
    return reply.code(validation.valid ? 200 : 400).send(validation);
  });

  app.post<{ Body: RegistrySyncBatchInput }>("/api/registry-sync/publish", { preHandler: guard }, async (request, reply) => {
    if (!expectedSchemaHash) return reply.code(503).send({ error: "registry_sync_not_configured" });
    try {
      return await publishRegistryBatch(db, request.body, expectedSchemaHash);
    } catch (error) {
      if (error instanceof RegistryBatchRejectedError) {
        return reply.code(409).send({ error: error.message, issues: error.issues });
      }
      throw error;
    }
  });

  app.get("/api/registry-sync/status", { preHandler: guard }, async () => getRegistrySyncStatus(db));
}

export function isRegistrySyncAuthorized(presentedToken?: string, configuredToken?: string): boolean {
  if (!configuredToken || !presentedToken) return false;
  const presented = Buffer.from(presentedToken, "utf8");
  const configured = Buffer.from(configuredToken, "utf8");
  return presented.length === configured.length && timingSafeEqual(presented, configured);
}

function registrySyncGuard(configuredToken?: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const value = request.headers["x-retail-registry-sync-token"];
    const presented = Array.isArray(value) ? value[0] : value;
    if (!isRegistrySyncAuthorized(presented, configuredToken)) {
      await reply.code(401).send({ error: "registry_sync_auth_failed" });
    }
  };
}
