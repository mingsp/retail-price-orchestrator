import type { GenerateRunPlanInput, GenerateRunPlanResult } from "@retail-orchestrator/shared";
import type { Pool } from "pg";
import { createRun, upsertStore } from "./tasks.js";

export async function generateRunPlan(db: Pool, input: GenerateRunPlanInput): Promise<GenerateRunPlanResult> {
  if (input.accountBudget < input.targetStores.length * input.accountsPerStore + input.spareAccounts) {
    throw new Error("account_budget_not_enough");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tx = client as unknown as Pool;
    const runIds: string[] = [];
    for (const target of input.targetStores) {
      await upsertStore(tx, {
        storeId: target.storeId,
        name: target.storeName,
        platform: "meituan_h5",
        url: "",
        status: "active",
        collectionPolicy: {
          role: target.role,
          pairId: target.pairId,
          cadence: target.weeklyCadence,
          accountsPerStore: input.accountsPerStore
        }
      });
      const run = await createRun(tx, {
        storeId: target.storeId,
        runLabel: `${input.runLabel} / ${target.storeName}`,
        strategy: "category_split"
      });
      runIds.push(run.runId);
    }
    await client.query("COMMIT");
    return {
      runIds,
      accountPlan: input.targetStores.map((target) => ({
        storeId: target.storeId,
        requiredAccounts: input.accountsPerStore,
        spareAllowed: input.spareAccounts > 0
      }))
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
