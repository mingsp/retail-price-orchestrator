import type { CreateScopeManifestInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { createScopeManifest, listScopeManifests } from "../repositories/scope-manifests.js";

export function registerScopeManifestRoutes(app: FastifyInstance, db: Pool): void {
  app.get<{ Querystring: { storeId?: string } }>("/api/scope-manifests", async (request) => ({
    scopeManifests: await listScopeManifests(db, request.query.storeId)
  }));
  app.post<{ Body: CreateScopeManifestInput }>("/api/scope-manifests", async (request) => ({
    scopeManifest: await createScopeManifest(db, request.body)
  }));
}
