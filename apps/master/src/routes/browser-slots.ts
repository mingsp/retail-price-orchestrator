import type {
  BindBrowserSlotInput,
  CreateBrowserSlotInput,
  UpdateBrowserSlotInput
} from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  bindBrowserSlot,
  buildAccountChangeNotice,
  createBrowserSlot,
  getBrowserSlot,
  listBrowserSlots,
  unbindBrowserSlot,
  updateBrowserSlot
} from "../repositories/browser-slots.js";
import { getAccount } from "../repositories/accounts.js";
import { insertOperationEvent } from "../repositories/operation-events.js";
import { operatorWriteGuard } from "../operator-auth.js";
import { operatorActor } from "./operation-events.js";

export function registerBrowserSlotRoutes(app: FastifyInstance, db: Pool, operatorToken?: string): void {
  app.get<{ Querystring: { workerId?: string } }>("/api/browser-slots", async (request) => ({
    slots: await listBrowserSlots(db, request.query.workerId)
  }));

  app.post<{ Body: CreateBrowserSlotInput }>("/api/browser-slots", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    try {
      return { slot: await createBrowserSlot(db, request.body) };
    } catch (error) {
      return sendSlotError(reply, error);
    }
  });

  app.patch<{ Params: { slotId: string }; Body: UpdateBrowserSlotInput }>("/api/browser-slots/:slotId", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    try {
      const slot = await updateBrowserSlot(db, request.params.slotId, request.body || {});
      return slot ? { slot } : reply.code(404).send({ error: "slot_not_found" });
    } catch (error) {
      return sendSlotError(reply, error);
    }
  });

  app.post<{ Params: { slotId: string }; Body: BindBrowserSlotInput }>("/api/browser-slots/:slotId/bind", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    try {
      const previous = await getBrowserSlot(db, request.params.slotId);
      const slot = await bindBrowserSlot(db, request.params.slotId, request.body);
      const account = await getAccount(db, request.body.accountId);
      const endpointIdentity = await db.query(`
        SELECT operator_owner
        FROM cdp_endpoints
        WHERE slot_id = $1 AND account_id = $2
        ORDER BY updated_at DESC
        LIMIT 1
      `, [slot.slotId, request.body.accountId]);
      const accountChange = buildAccountChangeNotice({
        previousAccountId: previous?.accountId,
        accountId: request.body.accountId,
        accountDisplayName: account?.displayName,
        maskedLogin: account?.maskedLogin,
        operatorOwner: endpointIdentity.rows[0]?.operator_owner || account?.displayName
      });
      await insertOperationEvent(db, {
        actor: operatorActor(request),
        action: accountChange.changed ? "browser_slot.account_changed" : "browser_slot.bound",
        targetType: "browser_slot",
        targetId: slot.slotId,
        workerId: slot.workerId,
        accountId: slot.accountId,
        profileId: slot.profileId,
        storeId: slot.targetStoreId,
        detail: {
          previousAccountId: previous?.accountId,
          maskedLogin: accountChange.maskedLogin,
          operatorOwner: accountChange.operatorOwner,
          localIdentityPageRequired: true
        }
      });
      return { slot, accountChange };
    } catch (error) {
      return sendSlotError(reply, error);
    }
  });

  app.post<{ Params: { slotId: string } }>("/api/browser-slots/:slotId/unbind", { preHandler: operatorWriteGuard(operatorToken) }, async (request, reply) => {
    const slot = await unbindBrowserSlot(db, request.params.slotId);
    return slot ? { slot } : reply.code(404).send({ error: "slot_not_found" });
  });
}

function sendSlotError(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.endsWith("_not_found") ? 404 : message.includes("already") ? 409 : 400;
  return reply.code(status).send({ error: message });
}
