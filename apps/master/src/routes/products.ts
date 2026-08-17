import type { IngestionErrorInput, ProductSnapshotBatchInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  buildProductDataQualityGate,
  buildProductDataQualityGateFromDb,
  ingestProductSnapshotBatch,
  summarizeCurrentValidProductSnapshots,
  summarizeProductSnapshots
} from "../repositories/products.js";
import { registerIngestionError } from "../repositories/ingestion-errors.js";
import { assertActiveTaskWriteLease } from "../repositories/task-write-guard.js";

export function registerProductRoutes(app: FastifyInstance, db: Pool): void {
  app.post<{ Body: ProductSnapshotBatchInput }>("/api/product-snapshots/batch", async (request, reply) => {
    try {
      return await ingestProductSnapshotBatch(db, request.body || { products: [], skus: [] }, {
        leaseOwner: request.body?.leaseOwner,
        leaseGeneration: request.body?.leaseGeneration
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("lease") ? 409 : 400;
      return reply.code(status).send({ error: message });
    }
  });
  app.post<{ Body: IngestionErrorInput }>("/api/ingestion-errors", async (request, reply) => {
    try {
      await assertActiveTaskWriteLease(db, request.body);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
    await registerIngestionError(db, request.body);
    return { ok: true };
  });

  app.get<{ Querystring: { runId?: string; taskId?: string; storeId?: string; scope?: string } }>(
    "/api/product-snapshots/summary",
    async (request) => {
      return {
        summary: request.query.scope === "current_valid"
          ? await summarizeCurrentValidProductSnapshots(db, request.query)
          : await summarizeProductSnapshots(db, request.query)
      };
    }
  );

  app.get<{ Querystring: { runId?: string; taskId?: string; storeId?: string; scope?: string; minUserFinalPriceCoverage?: string } }>(
    "/api/product-snapshots/quality-gate",
    async (request) => {
      const options = {
        minUserFinalPriceCoverage: request.query.minUserFinalPriceCoverage
          ? Number(request.query.minUserFinalPriceCoverage)
          : undefined
      };
      return {
        qualityGate: request.query.scope === "current_valid"
          ? buildProductDataQualityGate(await summarizeCurrentValidProductSnapshots(db, request.query), options)
          : await buildProductDataQualityGateFromDb(db, request.query, options)
      };
    }
  );
}
