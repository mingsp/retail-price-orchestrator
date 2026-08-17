import { loadConfig } from "../config.js";
import { createDb } from "../db.js";
import { freezeDelivery } from "../repositories/deliveries.js";
import { syncRetailMartRawData } from "../repositories/raw-data-sync.js";
import { buildRetailMartSyncDryRun, syncRetailMart } from "../repositories/retailmart-sync.js";
import { createS3Client } from "../s3.js";

const runIds = [
  "8d188942-1fcc-4ba5-80d7-a81105a2f410",
  "5192ebb5-9c99-4746-a1d4-109d4120735b"
];

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");
  const db = createDb(config.databaseUrl);
  const s3 = createS3Client(config.s3);
  try {
    for (const runId of runIds) {
      if (process.env.RETAILMART_DRY_RUN === "true") {
        const preview = await buildRetailMartSyncDryRun(db, { runId, minUserFinalPriceCoverage: 0 });
        process.stdout.write(`${runId}: ${preview.status}，SPU ${preview.sourceSpuRows}，SKU ${preview.sourceSkuRows}，问题 ${preview.errors.length}。\n`);
        if (preview.status !== "ready") throw new Error(`dry_run_blocked:${runId}:${preview.errors.join("|")}`);
        continue;
      }
      const frozen = await freezeDelivery(db, s3, runId, 0);
      if (frozen.blockers.length) {
        throw new Error(`freeze_blocked:${runId}:${frozen.blockers.join("|")}`);
      }
      const rawData = await syncRetailMartRawData(db, config.retailMart, s3, runId);
      const result = await syncRetailMart(db, config.retailMart, {
        runId,
        minUserFinalPriceCoverage: 0
      });
      process.stdout.write(
        `${runId}: 原始数据新增 ${rawData.insertedRows}，SPU ${result.upsertedSpuRows}，SKU ${result.upsertedSkuRows}。\n`
      );
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
