import type { AccountStatusUpdate, ProfileStatusUpdate } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { insertOperationEvent } from "../repositories/operation-events.js";
import {
  getAccount,
  getProfile,
  listAccounts,
  listProfiles,
  updateAccountStatus,
  updateProfileStatus
} from "../repositories/accounts.js";
import { operatorActor } from "./operation-events.js";

export function registerAccountRoutes(app: FastifyInstance, db: Pool): void {
  app.get("/api/accounts", async () => {
    return { accounts: await listAccounts(db) };
  });

  app.get<{ Params: { accountId: string } }>("/api/accounts/:accountId", async (request, reply) => {
    const account = await getAccount(db, request.params.accountId);
    if (!account) return reply.code(404).send({ error: "account_not_found" });
    return { account };
  });

  app.patch<{ Params: { accountId: string }; Body: AccountStatusUpdate }>(
    "/api/accounts/:accountId/status",
    async (request, reply) => {
      const before = await getAccount(db, request.params.accountId);
      const account = await updateAccountStatus(db, request.params.accountId, request.body || {});
      if (!account) return reply.code(404).send({ error: "account_not_found" });
      await insertOperationEvent(db, {
        actor: operatorActor(request),
        action: "account.status_update",
        targetType: "account",
        targetId: account.accountId,
        workerId: account.workerId,
        accountId: account.accountId,
        profileId: account.profileId,
        storeId: account.currentStoreId,
        detail: {
          beforeStatus: before?.status,
          afterStatus: account.status,
          beforeRiskLevel: before?.riskLevel,
          afterRiskLevel: account.riskLevel,
          update: request.body || {}
        }
      });
      return { account };
    }
  );

  app.get("/api/profiles", async () => {
    return { profiles: await listProfiles(db) };
  });

  app.get<{ Params: { profileId: string } }>("/api/profiles/:profileId", async (request, reply) => {
    const profile = await getProfile(db, request.params.profileId);
    if (!profile) return reply.code(404).send({ error: "profile_not_found" });
    return { profile };
  });

  app.patch<{ Params: { profileId: string }; Body: ProfileStatusUpdate }>(
    "/api/profiles/:profileId/status",
    async (request, reply) => {
      const before = await getProfile(db, request.params.profileId);
      const profile = await updateProfileStatus(db, request.params.profileId, request.body || {});
      if (!profile) return reply.code(404).send({ error: "profile_not_found" });
      await insertOperationEvent(db, {
        actor: operatorActor(request),
        action: "profile.status_update",
        targetType: "profile",
        targetId: profile.profileId,
        workerId: profile.workerId,
        accountId: profile.accountId,
        profileId: profile.profileId,
        detail: {
          beforeStatus: before?.status,
          afterStatus: profile.status,
          beforeAccountId: before?.accountId,
          afterAccountId: profile.accountId,
          update: request.body || {}
        }
      });
      return { profile };
    }
  );
}
