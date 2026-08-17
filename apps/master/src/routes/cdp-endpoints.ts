import type { CdpEndpointSnapshot } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { getCdpEndpoint, listCdpEndpoints, updateCdpEndpoint, upsertCdpEndpoint } from "../repositories/cdp-endpoints.js";

export function registerCdpEndpointRoutes(app: FastifyInstance, db: Pool): void {
  app.get<{ Querystring: { workerId?: string } }>("/api/cdp-endpoints", async (request) => {
    return { cdpEndpoints: await listCdpEndpoints(db, request.query.workerId) };
  });

  app.get<{ Params: { endpointId: string } }>("/api/cdp-endpoints/:endpointId", async (request, reply) => {
    const endpoint = await getCdpEndpoint(db, request.params.endpointId);
    if (!endpoint) return reply.code(404).send({ error: "cdp_endpoint_not_found" });
    return { cdpEndpoint: endpoint };
  });

  app.post<{ Body: CdpEndpointSnapshot & { workerId: string } }>("/api/cdp-endpoints", async (request) => {
    const endpoint = await upsertCdpEndpoint(db, request.body.workerId, request.body);
    return { cdpEndpoint: endpoint };
  });

  app.patch<{ Params: { endpointId: string }; Body: Partial<CdpEndpointSnapshot> }>(
    "/api/cdp-endpoints/:endpointId",
    async (request, reply) => {
      const endpoint = await updateCdpEndpoint(db, request.params.endpointId, request.body || {});
      if (!endpoint) return reply.code(404).send({ error: "cdp_endpoint_not_found" });
      return { cdpEndpoint: endpoint };
    }
  );
}
