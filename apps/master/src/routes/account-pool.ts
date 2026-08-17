import type { CreateAccountPoolInput, UpdateAccountPoolInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  createAccountPoolRecord,
  getAccountPoolRecord,
  listAccountPool,
  updateAccountPoolRecord
} from "../repositories/account-pool.js";
import { insertOperationEvent } from "../repositories/operation-events.js";
import { operatorActor } from "./operation-events.js";

export function registerAccountPoolRoutes(app: FastifyInstance, db: Pool): void {
  app.get("/api/account-pool", async () => ({ accounts: await listAccountPool(db) }));

  app.post<{ Body: CreateAccountPoolInput }>("/api/account-pool", async (request, reply) => {
    try {
      const account = await createAccountPoolRecord(db, request.body || {} as CreateAccountPoolInput);
      await insertOperationEvent(db, {
        actor: operatorActor(request),
        action: "account_pool.created",
        targetType: "account_pool",
        targetId: account.accountId,
        accountId: account.accountId,
        detail: {
          displayName: account.displayName,
          maskedLogin: account.maskedLogin,
          operatorOwner: account.operatorOwner,
          status: account.status
        }
      });
      return reply.code(201).send({ account });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "account_pool_create_failed" });
    }
  });

  app.patch<{ Params: { accountId: string }; Body: UpdateAccountPoolInput }>(
    "/api/account-pool/:accountId",
    async (request, reply) => {
      try {
        const before = await getAccountPoolRecord(db, request.params.accountId);
        if (!before) return reply.code(404).send({ error: "account_pool_not_found" });
        const account = await updateAccountPoolRecord(db, request.params.accountId, request.body || {});
        if (!account) return reply.code(404).send({ error: "account_pool_not_found" });
        await insertOperationEvent(db, {
          actor: operatorActor(request),
          action: "account_pool.updated",
          targetType: "account_pool",
          targetId: account.accountId,
          accountId: account.accountId,
          workerId: account.assignedWorkerId,
          storeId: account.currentStoreId,
          detail: {
            beforeStatus: before.status,
            afterStatus: account.status,
            beforeRiskLevel: before.riskLevel,
            afterRiskLevel: account.riskLevel,
            availableAfter: account.availableAfter || null
          }
        });
        return { account };
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : "account_pool_update_failed" });
      }
    }
  );
}
