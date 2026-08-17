import assert from "node:assert/strict";
import test from "node:test";
import type { ProductSnapshotInput, SkuSnapshotInput } from "@retail-orchestrator/shared";
import {
  buildProductDataQualityGate,
  buildProductUniqueKey,
  buildSkuUniqueKey,
  summarizeCurrentValidProductSnapshots,
  summarizeProductBatch,
  summarizeProductSnapshots,
  validateProductBatchIdentity
} from "../src/repositories/products.js";

test("product and sku unique keys preserve the same item under different categories", () => {
  const product: Pick<ProductSnapshotInput, "runId" | "taskId" | "storeId" | "categoryName" | "spuId"> = {
    runId: "native-run-1",
    taskId: "task-1",
    storeId: "store-1",
    categoryName: "日用百货 / 清洁工具",
    spuId: "90000000001"
  };
  const sku: Pick<SkuSnapshotInput, "runId" | "taskId" | "storeId" | "categoryName" | "spuId" | "skuId"> = {
    ...product,
    skuId: "90000000002"
  };

  assert.equal(buildProductUniqueKey(product), "native-run-1|store-1|日用百货 / 清洁工具|90000000001");
  assert.equal(buildSkuUniqueKey(sku), "native-run-1|store-1|日用百货 / 清洁工具|90000000001|90000000002");
  assert.notEqual(buildProductUniqueKey({ ...product, taskId: "task-2", categoryName: "推荐" }), buildProductUniqueKey(product));
  assert.notEqual(buildSkuUniqueKey({ ...sku, taskId: "task-2", categoryName: "推荐" }), buildSkuUniqueKey(sku));
});

test("summarizeProductBatch reports durable production metrics", () => {
  const products = [
    {
      runId: "run-1",
      taskId: "task-1",
      storeId: "store-1",
      categoryName: "推荐",
      spuId: "spu-1",
      productName: "商品A",
      frontDisplayPriceText: "9.9",
      userFinalPriceText: "8.8",
      raw: {}
    },
    {
      runId: "run-1",
      taskId: "task-1",
      storeId: "store-1",
      categoryName: "推荐",
      spuId: "spu-2",
      productName: "商品B",
      raw: {}
    }
  ] satisfies ProductSnapshotInput[];

  const skus = [
    {
      runId: "run-1",
      taskId: "task-1",
      storeId: "store-1",
      categoryName: "推荐",
      spuId: "spu-1",
      skuId: "sku-1",
      productName: "商品A",
      frontDisplayPriceText: "9.9",
      raw: {}
    }
  ] satisfies SkuSnapshotInput[];

  assert.deepEqual(summarizeProductBatch({ products, skus }), {
    products: 2,
    skus: 1,
    frontDisplayPriceCount: 2,
    userFinalPriceCount: 1
  });
});

test("product batches cannot mix task store run or worker identities", () => {
  const product = {
    runId: "run-1",
    taskId: "task-1",
    storeId: "store-1",
    workerId: "worker-a",
    categoryName: "推荐",
    spuId: "spu-1",
    productName: "商品A",
    raw: {}
  } satisfies ProductSnapshotInput;
  const sku = {
    runId: "run-1",
    taskId: "task-1",
    storeId: "store-1",
    workerId: "worker-a",
    categoryName: "推荐",
    spuId: "spu-1",
    skuId: "sku-1",
    productName: "商品A",
    raw: {}
  } satisfies SkuSnapshotInput;

  assert.deepEqual(validateProductBatchIdentity({ products: [product], skus: [sku] }), {
    runId: "run-1",
    taskId: "task-1",
    storeId: "store-1",
    workerId: "worker-a"
  });
  assert.throws(() => validateProductBatchIdentity({
    products: [product],
    skus: [{ ...sku, taskId: "task-2" }]
  }), /mixed_product_batch_identity/);
  assert.throws(() => validateProductBatchIdentity({ products: [], skus: [] }), /empty_product_batch/);
});

test("product batches use the current write worker while preserving migrated row provenance", () => {
  const product = {
    runId: "run-1",
    taskId: "task-1",
    storeId: "store-1",
    workerId: "source-worker-a",
    categoryName: "家庭清洁",
    spuId: "spu-1",
    productName: "商品A",
    raw: {}
  } satisfies ProductSnapshotInput;
  const sku = {
    runId: "run-1",
    taskId: "task-1",
    storeId: "store-1",
    workerId: "source-worker-b",
    categoryName: "家庭清洁",
    spuId: "spu-1",
    skuId: "sku-1",
    productName: "商品A",
    raw: {}
  } satisfies SkuSnapshotInput;

  assert.deepEqual(validateProductBatchIdentity({
    writeWorkerId: "recovery-worker",
    products: [product],
    skus: [sku]
  }), {
    runId: "run-1",
    taskId: "task-1",
    storeId: "store-1",
    workerId: "recovery-worker"
  });
  assert.equal(product.workerId, "source-worker-a");
  assert.equal(sku.workerId, "source-worker-b");
});

test("buildProductDataQualityGate allows complete page prices when user final price is naturally sparse", () => {
  const gate = buildProductDataQualityGate(
    {
      runId: "run-1",
      productCount: 2,
      skuCount: 2,
      frontDisplayPriceCount: 4,
      userFinalPriceCount: 2
    },
    { minUserFinalPriceCoverage: 0.8 }
  );

  assert.equal(gate.status, "pass");
  assert.equal(gate.businessExportAllowed, true);
  assert.equal(gate.missingUserFinalPriceCount, 2);
  assert.equal(gate.userFinalPriceCoverage, 0.5);
  assert.equal(gate.frontDisplayPriceCoverage, 1);
  assert.equal(gate.missingFrontDisplayPriceCount, 0);
});

test("buildProductDataQualityGate blocks export when a page display price is missing", () => {
  const gate = buildProductDataQualityGate({
    runId: "run-1",
    productCount: 2,
    skuCount: 2,
    frontDisplayPriceCount: 3,
    userFinalPriceCount: 0
  });

  assert.equal(gate.status, "fail");
  assert.equal(gate.businessExportAllowed, false);
  assert.equal(gate.missingFrontDisplayPriceCount, 1);
  assert.equal(gate.frontDisplayPriceCoverage, 0.75);
  assert.match(gate.reason, /页面展示价缺失/);
});

test("buildProductDataQualityGate allows export when user final price coverage reaches threshold", () => {
  const gate = buildProductDataQualityGate(
    {
      runId: "run-1",
      productCount: 1,
      skuCount: 4,
      frontDisplayPriceCount: 5,
      userFinalPriceCount: 4
    },
    { minUserFinalPriceCoverage: 0.8 }
  );

  assert.equal(gate.status, "pass");
  assert.equal(gate.businessExportAllowed, true);
  assert.equal(gate.userFinalPriceCoverage, 0.8);
});

test("buildProductDataQualityGate blocks export when invalid zero final prices exist", () => {
  const gate = buildProductDataQualityGate(
    {
      runId: "run-1",
      productCount: 1,
      skuCount: 4,
      frontDisplayPriceCount: 5,
      userFinalPriceCount: 4,
      invalidUserFinalPriceCount: 1
    },
    { minUserFinalPriceCoverage: 0.8 }
  );

  assert.equal(gate.status, "fail");
  assert.equal(gate.businessExportAllowed, false);
  assert.equal(gate.invalidUserFinalPriceCount, 1);
  assert.match(gate.reason, /无效到手价/);
});

test("buildProductDataQualityGate blocks export when raw embedded SKUs do not reconcile", () => {
  const gate = buildProductDataQualityGate({
    runId: "run-1",
    productCount: 2,
    skuCount: 3,
    rawEmbeddedSkuCount: 4,
    frontDisplayPriceCount: 5,
    userFinalPriceCount: 0
  });

  assert.equal(gate.status, "fail");
  assert.equal(gate.businessExportAllowed, false);
  assert.equal(gate.skuReconciliationDelta, -1);
  assert.match(gate.reason, /相差 1 个/);
});

test("buildProductDataQualityGate accepts SKU-level raw evidence omitted from the latest product snapshot", () => {
  const gate = buildProductDataQualityGate({
    runId: "run-1",
    productCount: 2,
    skuCount: 4,
    rawEmbeddedSkuCount: 3,
    rawEvidencedSkuCount: 4,
    frontDisplayPriceCount: 6,
    userFinalPriceCount: 0
  });

  assert.equal(gate.status, "pass");
  assert.equal(gate.businessExportAllowed, true);
  assert.equal(gate.rawEmbeddedSkuCount, 3);
  assert.equal(gate.rawEvidencedSkuCount, 4);
  assert.equal(gate.skuReconciliationDelta, 0);
});

test("current valid summary excludes legacy capture identities and unvalidated categories", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[]) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ product_count: 10, front_display_price_count: 9, user_final_price_count: 3, latest_snapshot_at: new Date("2026-07-13T00:00:00.000Z") }] }
        : { rows: [{ sku_count: 14, front_display_price_count: 12, user_final_price_count: 4 }] };
    }
  } as any;

  const summary = await summarizeCurrentValidProductSnapshots(db, {
    storeId: "store-1",
    runId: "run-1",
    taskId: "task-1"
  });

  assert.equal(summary.productCount, 10);
  assert.equal(summary.skuCount, 14);
  assert.equal(summary.userFinalPriceCount, 7);
  assert.equal(summary.storeId, "store-1");
  assert.equal(summary.runId, "run-1");
  assert.equal(summary.taskId, "task-1");
  for (const { sql, params } of queries) {
    assert.match(sql, /run_id\s*=\s*\w+\.store_run_id::text/);
    assert.match(sql, /status\s*=\s*'completed_valid'/);
    assert.match(sql, /product_category_memberships/);
    assert.match(sql, /store_id\s*=\s*\$1/);
    assert.match(sql, /store_run_id::text\s*=\s*\$2/);
    assert.match(sql, /task_uuid::text\s*=\s*\$3/);
    assert.deepEqual(params, ["store-1", "run-1", "task-1"]);
  }
});

test("filtered summaries use canonical run and task identities only", async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    async query(sql: string, params: unknown[]) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ product_count: 2, front_display_price_count: 2, user_final_price_count: 1 }] }
        : { rows: [{ sku_count: 3, front_display_price_count: 3, user_final_price_count: 1 }] };
    }
  } as any;

  await summarizeProductSnapshots(db, { runId: "run-uuid", taskId: "task-uuid", storeId: "store-1" });

  for (const { sql, params } of queries) {
    assert.match(sql, /run_id\s*=\s*\w+\.store_run_id::text/);
    assert.match(sql, /store_run_id::text\s*=\s*\$1/);
    assert.match(sql, /task_uuid::text\s*=\s*\$2/);
    assert.doesNotMatch(sql, /OR\s+store_run_id::text/);
    assert.deepEqual(params, ["run-uuid", "task-uuid", "store-1"]);
  }
});
