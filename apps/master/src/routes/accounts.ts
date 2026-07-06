import type { AccountStatusUpdate, ProfileStatusUpdate } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  getAccount,
  getProfile,
  listAccounts,
  listProfiles,
  updateAccountStatus,
  updateProfileStatus
} from "../repositories/accounts.js";

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
      const account = await updateAccountStatus(db, request.params.accountId, request.body || {});
      if (!account) return reply.code(404).send({ error: "account_not_found" });
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
      const profile = await updateProfileStatus(db, request.params.profileId, request.body || {});
      if (!profile) return reply.code(404).send({ error: "profile_not_found" });
      return { profile };
    }
  );
}
