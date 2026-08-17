import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDryRunErrors,
  buildMissingFieldStats,
  buildUpsertUpdateColumns,
  buildRetailMartSkuFactRow,
  buildRetailMartSpuFactRow,
  truncateToShanghaiHour
} from "../src/repositories/retailmart-sync.js";
import { buildFreezeBlockers } from "../src/repositories/deliveries.js";
import ExcelJS from "exceljs";
import { buildBusinessWorkbook, buildExportObjectKey, businessProductColumns } from "../src/repositories/business-export.js";
import {
  classifyFactSchema,
  compactSkuRemovedColumns,
  compactSpuRemovedColumns
} from "../src/repositories/retailmart-schema.js";

test("RetailMart snapshot time is converted to Shanghai time and truncated to the hour", () => {
  assert.equal(truncateToShanghaiHour("2026-07-10T02:47:35.123Z"), "2026-07-10 10:00:00");
  assert.equal(truncateToShanghaiHour(undefined), null);
});

test("business workbook can be reopened and preserves the original product name", async () => {
  const workbook = buildBusinessWorkbook([{
    store_name: "乐购达景耀店",
    category_name: "饮料",
    spu_id: "spu-1",
    product_name: "原始商品名【限定】",
    actual_price: 9.9,
    front_display_price_text: "¥12.90",
    raw: {},
    promotion_info: ""
  }], [], { storeName: "乐购达景耀店", runLabel: "weekly", coverage: 1 });
  const buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  assert.equal(reopened.getWorksheet("商品清单")?.getCell("C2").value, "原始商品名【限定】");
  assert.deepEqual(reopened.worksheets.map((sheet) => sheet.name), ["商品清单", "SKU规格明细", "类目汇总", "说明"]);
});

test("business workbook path is versioned and business columns exclude machine fields", () => {
  assert.equal(
    buildExportObjectKey("8d188942-1fcc-4ba5-80d7-a81105a2f410", 3),
    "business-exports/8d188942-1fcc-4ba5-80d7-a81105a2f410/v3/store-price-data.xlsx"
  );
  assert.equal(businessProductColumns.includes("商品名称"), true);
  assert.equal(businessProductColumns.some((column) => /run|cdp|profile|account/i.test(column)), false);
});

test("delivery freeze blocks incomplete runs even when raw data exists", () => {
  assert.deepEqual(buildFreezeBlockers({
    runDeliverable: false,
    qualityGatePassed: true,
    rawArtifactCount: 2,
    productCount: 5000
  }), ["门店批次尚未完成全部类目校验。"]);
});

test("SPU fact preserves independent source prices without storing a derived comparison price", () => {
  const row = buildRetailMartSpuFactRow({
    runId: "8d188942-1fcc-4ba5-80d7-a81105a2f410",
    storeId: "store-1",
    storeName: "乐购达景耀店",
    storeType: "competitor",
    categoryName: "饮料",
    categoryOrder: 12,
    spuId: "spu-1",
    productName: "原始商品名【限定】",
    sourceTs: "2026-07-10T02:47:35.123Z",
    productFrontDisplayPriceText: "¥12.90",
    productFrontDisplayPriceAmount: 12.9,
    productUserPriceAmount: 9.9,
    priceSemantics: "actual_payable",
    userFinalPriceSourcePath: "productRaw.actual_price_info.price",
    skuCount: 3,
    productRaw: { unify_price: { price: 13.9, underlined_price: 15.9 } }
  });

  assert.equal(row.product_name, "原始商品名【限定】");
  assert.equal(row.snapshot_hour, "2026-07-10 10:00:00");
  assert.equal(row.front_display_price_amount, 12.9);
  assert.equal(row.user_final_price_amount, 9.9);
  assert.equal(row.original_price_amount, 15.9);
  assert.equal("comparison_price_amount" in row, false);
  assert.equal("comparison_price_type" in row, false);
  assert.equal(row.category_order, 12);
  assert.equal("brand_name" in row, false);
  assert.equal("sku_count" in row, false);
  assert.equal("base_price_amount" in row, false);
  assert.equal("spu_price_basis" in row, false);
  assert.equal("match_method" in row, false);
  assert.equal("match_confidence" in row, false);
  assert.equal("price_quality" in row, false);
  assert.equal("created_at" in row, false);
});

test("SPU fact leaves an unevidenced final price empty", () => {
  const row = buildRetailMartSpuFactRow({
    runId: "8d188942-1fcc-4ba5-80d7-a81105a2f410",
    storeId: "store-1",
    storeName: "乐购达景耀店",
    categoryName: "饮料",
    categoryOrder: 12,
    spuId: "spu-1",
    productName: "原始商品名",
    sourceTs: "2026-07-10T02:47:35.123Z",
    productFrontDisplayPriceAmount: 12.9,
    productUserPriceAmount: 9.9,
    priceSemantics: "front_display_only"
  });

  assert.equal(row.user_final_price_amount, null);
  assert.equal(row.front_display_price_amount, 12.9);
  assert.equal(row.match_status, "unmatched");
});

test("zero actual price never enters RetailMart as a verified user final price", () => {
  const row = buildRetailMartSpuFactRow({
    runId: "8d188942-1fcc-4ba5-80d7-a81105a2f410",
    storeId: "store-1",
    storeName: "乐购达景耀店",
    categoryName: "啤酒",
    categoryOrder: 12,
    spuId: "spu-1",
    productName: "单罐啤酒",
    sourceTs: "2026-07-10T02:47:35.123Z",
    productFrontDisplayPriceAmount: 6.8,
    productUserPriceAmount: 0,
    priceSemantics: "actual_payable",
    userFinalPriceSourcePath: "productRaw.unify_price.actual_price_info.actual_price_str"
  });

  assert.equal(row.user_final_price_amount, null);
  assert.equal(row.front_display_price_amount, 6.8);
});

test("zero page entries are preserved as source facts for the comparison script to exclude", () => {
  const row = buildRetailMartSpuFactRow({
    runId: "8d188942-1fcc-4ba5-80d7-a81105a2f410",
    storeId: "store-1",
    storeName: "乐购达景耀店",
    categoryName: "门店说明",
    spuId: "notice-1",
    productName: "配送温馨提示",
    sourceTs: "2026-07-10T02:47:35.123Z",
    productFrontDisplayPriceAmount: 0,
    productOriginalPriceAmount: 0
  });

  assert.equal(row.front_display_price_amount, 0);
  assert.equal("comparison_price_amount" in row, false);
  assert.equal("comparison_price_type" in row, false);
});

test("SKU fact prefers evidenced SKU final price and keeps readable source IDs", () => {
  const row = buildRetailMartSkuFactRow({
    runId: "5192ebb5-9c99-4746-a1d4-109d4120735b",
    storeId: "store-2",
    storeName: "呱呱超市莲湖店",
    storeType: "own",
    categoryName: "饮料",
    categoryOrder: 3,
    spuId: "spu-2",
    skuId: "sku-2",
    productName: "原始 SKU 商品名",
    sourceTs: "2026-07-10T02:47:35.123Z",
    skuFrontDisplayPriceAmount: 8.8,
    skuEffectivePriceAmount: 7.7,
    skuPriceSemantics: "actual_payable",
    skuUserFinalPriceSourcePath: "skuRaw.actual_price_info.price",
    promotionInfo: "满减",
    skuRaw: { spec: "500ml", upccode: "690000000001", price: 9.9, origin_price: 11.9, stock: 8, status: 0 }
  });

  assert.equal(row.source_spu_id, "spu-2");
  assert.equal(row.source_sku_id, "sku-2");
  assert.equal(row.spec_name, "500ml");
  assert.equal(row.upc, "690000000001");
  assert.equal(row.user_final_price_amount, 7.7);
  assert.equal(row.original_price_amount, 11.9);
  assert.equal("comparison_price_amount" in row, false);
  assert.equal("comparison_price_type" in row, false);
  assert.equal(row.sale_status, "available");
  assert.equal("unit_price_amount" in row, false);
  assert.equal("match_method" in row, false);
  assert.equal("match_confidence" in row, false);
  assert.equal("price_quality" in row, false);
  assert.equal("created_at" in row, false);
});

test("RetailMart rows never fabricate a collection hour", () => {
  const row = buildRetailMartSpuFactRow({
    runId: "8d188942-1fcc-4ba5-80d7-a81105a2f410",
    storeId: "store-1",
    storeName: "乐购达景耀店",
    categoryName: "饮料",
    categoryOrder: 12,
    spuId: "spu-1",
    productName: "原始商品名"
  });

  assert.equal(row.snapshot_hour, null);
});

test("missing evidenced user price is recorded as quality metadata instead of dropping the SKU", () => {
  const stats = buildMissingFieldStats([{
    storeId: "store-1",
    storeName: "乐购达景耀店",
    categoryName: "饮料",
    spuId: "spu-1",
    skuId: "sku-1",
    productName: "原始商品名",
    frontDisplayPriceText: "12.90",
    sourceTs: "2026-07-10 10:00:00.000",
    dataQuality: "missing_user_final_price"
  }]);

  assert.deepEqual(buildDryRunErrors([{
    storeId: "store-1",
    storeName: "乐购达景耀店",
    categoryName: "饮料",
    spuId: "spu-1",
    skuId: "sku-1",
    productName: "原始商品名",
    frontDisplayPriceText: "12.90",
    sourceTs: "2026-07-10 10:00:00.000",
    dataQuality: "missing_user_final_price"
  }], stats, true), []);
});

test("compact RetailMart schema rejects a partially migrated table", () => {
  assert.equal(classifyFactSchema(["id", ...compactSpuRemovedColumns], compactSpuRemovedColumns), "legacy");
  assert.equal(classifyFactSchema(["id", "batch_id"], compactSpuRemovedColumns), "compact");
  assert.equal(
    classifyFactSchema(["id", compactSpuRemovedColumns[0]], compactSpuRemovedColumns),
    "mixed"
  );
  assert.deepEqual(compactSpuRemovedColumns, [
    "brand_name",
    "sku_count",
    "base_price_amount",
    "spu_price_basis",
    "match_method",
    "match_confidence",
    "price_quality",
    "created_at"
  ]);
  assert.deepEqual(compactSkuRemovedColumns, [
    "unit_price_amount",
    "match_method",
    "match_confidence",
    "price_quality",
    "created_at"
  ]);
});

test("repeated snapshot sync preserves confirmed matching results", () => {
  assert.deepEqual(
    buildUpsertUpdateColumns([
      "batch_id",
      "store_code",
      "source_spu_id",
      "source_sku_id",
      "product_name",
      "standard_spu_id",
      "standard_sku_id",
      "match_status",
      "front_display_price_amount"
    ]),
    ["product_name", "front_display_price_amount"]
  );
});
