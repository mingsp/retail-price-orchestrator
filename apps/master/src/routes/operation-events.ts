import type { OperationEventInput } from "@retail-orchestrator/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { insertOperationEvent, listOperationEvents } from "../repositories/operation-events.js";

export function operatorActor(request: FastifyRequest): string {
  const header = request.headers["x-operator-actor"];
  if (Array.isArray(header)) return header[0] || "dashboard";
  return header || "dashboard";
}

export function registerOperationEventRoutes(app: FastifyInstance, db: Pool): void {
  app.get<{
    Querystring: {
      taskId?: string;
      accountId?: string;
      profileId?: string;
      cdpEndpointId?: string;
      riskId?: string;
      limit?: string;
    };
  }>("/api/operation-events", async (request) => {
    return {
      operationEvents: await listOperationEvents(db, {
        taskId: request.query.taskId,
        accountId: request.query.accountId,
        profileId: request.query.profileId,
        cdpEndpointId: request.query.cdpEndpointId,
        riskId: request.query.riskId,
        limit: request.query.limit ? Number(request.query.limit) : undefined
      })
    };
  });

  app.post<{ Body: OperationEventInput }>("/api/operation-events", async (request) => {
    const event = await insertOperationEvent(db, request.body, { actor: operatorActor(request) });
    return { operationEvent: event };
  });
}
