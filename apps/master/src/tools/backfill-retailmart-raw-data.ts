import { loadConfig } from "../config.js";
import { createDb } from "../db.js";
import { syncRetailMartRawData } from "../repositories/raw-data-sync.js";
import { createS3Client } from "../s3.js";

const defaultRunIds = [
  "8d188942-1fcc-4ba5-80d7-a81105a2f410",
  "5192ebb5-9c99-4746-a1d4-109d4120735b"
];

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.retailMart) throw new Error("retailmart_not_configured");
  const runIds = process.argv.slice(2).length ? process.argv.slice(2) : defaultRunIds;
  const db = createDb(config.databaseUrl);
  const s3 = createS3Client(config.s3);
  try {
    for (const runId of runIds) {
      const result = await syncRetailMartRawData(db, config.retailMart, s3, runId);
      process.stdout.write(
        `${runId}: 扫描 ${result.scannedRows}，门店数据 ${result.sourceRows}，新增 ${result.insertedRows}，重复 ${result.duplicateRows}，商品 ${result.productRows}，类目 ${result.categoryRows}，忽略运行事件 ${result.ignoredRows}。\n`
      );
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
