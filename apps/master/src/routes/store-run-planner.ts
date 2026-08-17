import type { GenerateRunPlanInput } from "@retail-orchestrator/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { generateRunPlan } from "../repositories/store-run-planner.js";

export function registerStoreRunPlannerRoutes(app: FastifyInstance, db: Pool): void {
  app.post<{ Body: GenerateRunPlanInput }>("/api/run-plans/stage-one", async (request, reply) => {
    try {
      return { plan: await generateRunPlan(db, request.body) };
    } catch (error) {
      if (error instanceof Error && error.message === "account_budget_not_enough") {
        return reply.code(400).send({ error: "account_budget_not_enough" });
      }
      throw error;
    }
  });
}
