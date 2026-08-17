import type { ClaimCdpCommandInput, CompleteCdpCommandInput, CreateCdpCommandInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { claimNextCdpCommand, completeCdpCommand, createCdpCommand, listCdpCommands } from "../repositories/cdp-commands.js";
import { insertOperationEvent } from "../repositories/operation-events.js";
import { operatorActor } from "./operation-events.js";
import { getWorkerAuthentication } from "../worker-auth.js";
import { operatorWriteGuard } from "../operator-auth.js";

export function registerCdpCommandRoutes(app: FastifyInstance, db: Pool, operatorToken?: string): void {
  app.get<{ Querystring: { workerId?: string } }>("/api/cdp-commands", async (request) => {
    return { commands: await listCdpCommands(db, request.query.workerId) };
  });

  app.post<{ Body: CreateCdpCommandInput }>("/api/cdp-commands", { preHandler: operatorWriteGuard(operatorToken) }, async (request) => {
    const command = await createCdpCommand(db, request.body);
    await insertOperationEvent(db, {
      actor: operatorActor(request),
      action: `cdp.${command.action}`,
      targetType: "cdp_command",
      targetId: command.commandId,
      workerId: command.workerId,
      accountId: command.accountId,
      profileId: command.profileId,
      cdpEndpointId: command.endpointId,
      storeId: command.targetStoreId,
      detail: {
        port: command.port,
        status: command.status,
        targetStoreName: command.targetStoreName,
        maskedLogin: command.maskedLogin,
        operatorOwner: command.operatorOwner,
        proxyMode: command.proxyMode
      }
    });
    return { command };
  });

  app.post<{ Body: ClaimCdpCommandInput }>("/api/cdp-commands/claim", async (request, reply) => {
    const authentication = getWorkerAuthentication(request);
    if (!authentication) return reply.code(401).send({ error: "worker_auth_required" });
    if (request.body.workerId !== authentication.workerId) return reply.code(403).send({ error: "worker_identity_mismatch" });
    return claimNextCdpCommand(db, { workerId: authentication.workerId });
  });

  app.post<{ Params: { commandId: string }; Body: CompleteCdpCommandInput }>(
    "/api/cdp-commands/:commandId/complete",
    async (request, reply) => {
      const authentication = getWorkerAuthentication(request);
      if (!authentication) return reply.code(401).send({ error: "worker_auth_required" });
      const command = await completeCdpCommand(db, request.params.commandId, request.body, authentication?.workerId);
      if (!command) return reply.code(409).send({ error: "cdp_command_lease_lost" });
      return { command };
    }
  );
}
