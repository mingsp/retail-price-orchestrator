import type { RetailMartSyncRunInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Client } from "minio";
import type { Pool } from "pg";
import { syncRetailMartRawData } from "../repositories/raw-data-sync.js";
import { buildRetailMartSyncDryRun, syncRetailMart, type RetailMartDbConfig } from "../repositories/retailmart-sync.js";

export function registerRetailMartSyncRoutes(
  app: FastifyInstance,
  db: Pool,
  s3: Client,
  config?: RetailMartDbConfig
): void {
  app.post<{ Body: RetailMartSyncRunInput }>("/api/retailmart-sync/run", async (request, reply) => {
    const input = request.body;
    if (!input?.runId) return reply.code(400).send({ error: "run_id_required" });
    if (input.dryRun === false) {
      if (!config) return reply.code(503).send({ error: "retailmart_not_configured" });
      try {
        const preflight = await buildRetailMartSyncDryRun(db, {
          runId: input.runId,
          minUserFinalPriceCoverage: input.minUserFinalPriceCoverage
        });
        if (preflight.status !== "ready") {
          throw new Error(`retailmart_sync_blocked:${preflight.errors.join("|")}`);
        }
        const rawData = await syncRetailMartRawData(db, config, s3, input.runId);
        return {
          rawData,
          result: await syncRetailMart(db, config, input)
        };
      } catch (error) {
        return reply.code(409).send({
          error: "retailmart_sync_blocked",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return {
      result: await buildRetailMartSyncDryRun(db, {
        runId: input.runId,
        minUserFinalPriceCoverage: input.minUserFinalPriceCoverage
      })
    };
  });
}
