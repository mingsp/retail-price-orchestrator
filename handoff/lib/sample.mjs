import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createReadStream } from "node:fs";
import {
  listFilesRecursive,
  readJsonl,
  writeJsonAtomic,
  writeJsonl
} from "./files.mjs";
import { createSanitizer, scanText } from "./redaction.mjs";

export function auditSample({ rawRows = [], checkpoint = {}, riskEvents = [] }) {
  const spus = new Set();
  const skus = new Map();
  const categories = new Set();
  const relations = new Set();

  for (const row of rawRows) {
    const categoryTag = text(row?.category?.tag || row?.productRaw?.tag);
    const product = object(row?.productRaw);
    const spuId = text(product.id ?? product.spu_id ?? row?.productIndex?.spuId);
    if (categoryTag) categories.add(categoryTag);
    if (spuId) {
      spus.add(spuId);
      relations.add(`${categoryTag}|${spuId}`);
    }

    const productIndexSkus = Array.isArray(row?.productIndex?.skus)
      ? row.productIndex.skus
      : [];
    const indexSkuById = new Map(
      productIndexSkus.map((sku) => [text(sku?.skuId ?? sku?.id), sku])
    );
    const rawSkus = Array.isArray(product.skus) ? product.skus : productIndexSkus;
    for (const sku of rawSkus) {
      const skuId = text(sku?.id ?? sku?.sku_id ?? sku?.skuId);
      if (!skuId) continue;
      const indexed = indexSkuById.get(skuId);
      skus.set(skuId, {
        priced: firstPrice(indexed, sku, product) !== null
      });
    }
  }

  const pricedSku = [...skus.values()].filter((sku) => sku.priced).length;
  return {
    rawRows: rawRows.length,
    uniqueSpu: spus.size,
    uniqueSku: skus.size,
    categoryProductRelations: relations.size,
    categories: categories.size,
    pricedSku,
    frontDisplayPriceCoverage: skus.size ? pricedSku / skus.size : 0,
    riskEvents: riskEvents.length,
    checkpointCompletedCategories: completedCategoryCount(checkpoint)
  };
}

export async function buildDeidentifiedSample({ sourceRoot, outputRoot }) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  const relativeFiles = await listFilesRecursive(source);
  const rawCandidates = relativeFiles
    .filter((file) => file.endsWith(".products.raw.jsonl"))
    .map((file) => path.join(source, file));
  if (!rawCandidates.length) throw new Error("sample_source_raw_missing");

  const rankedRawFiles = (
    await Promise.all(
      rawCandidates.map(async (file) => ({
        file,
        size: (await fs.stat(file)).size
      }))
    )
  ).sort((left, right) => right.size - left.size);

  let sourceRawFile = "";
  let sourceRows = [];
  for (const candidate of rankedRawFiles) {
    const rows = await selectRepresentativeRawRows(candidate.file);
    if (rows.length >= 3) {
      sourceRawFile = candidate.file;
      sourceRows = rows;
      break;
    }
  }
  if (!sourceRawFile) throw new Error("representative_sample_rows_missing");

  const directory = path.dirname(sourceRawFile);
  const siblingNames = await fs.readdir(directory);
  const planFile = siblingNames.find((name) => name.endsWith(".plan.json"));
  const progressFile = siblingNames.find((name) => name.endsWith(".progress.jsonl"));
  const sourcePlan = planFile
    ? JSON.parse(await fs.readFile(path.join(directory, planFile), "utf8"))
    : { plan: [] };
  const localProgress = progressFile
    ? await readJsonl(path.join(directory, progressFile))
    : [];
  const riskSource = await findRiskEvent(source, relativeFiles);
  const selectedTags = new Set(
    sourceRows.map((row) => text(row?.category?.tag || row?.productRaw?.tag)).filter(Boolean)
  );
  const planRows = (Array.isArray(sourcePlan.plan) ? sourcePlan.plan : [])
    .filter((item) => selectedTags.has(text(item?.tag)) || item?.parentName === "活动")
    .slice(0, 6);
  const progressRows = selectProgressRows(localProgress, riskSource);

  const sanitize = createSanitizer();
  const rawRows = sourceRows.map((row) => sanitize(row));
  const plan = {
    generatedAt: new Date().toISOString(),
    sampleOnly: true,
    plan: planRows.map((row) => sanitize(row))
  };
  const progress = progressRows.map((row) => sanitize(row));
  const riskEvents = riskSource
    ? [
        sanitize({
          ts: riskSource.ts,
          type: riskType(riskSource),
          status: "manual_required",
          workerId: riskSource.workerId,
          taskId: riskSource.taskId,
          accountId: riskSource.accountId || "source-account",
          profileId: riskSource.profileId || "source-profile",
          storeId: riskSource.storeId || "source-store",
          category: riskSource.category || riskSource.label || "",
          message: riskSource.err?.message || riskSource.message || "source risk event"
        })
      ]
    : [];
  const firstCategory = rawRows[0]?.category;
  const checkpoint = {
    runId: "sample-run-01",
    captureId: "sample-run-01",
    taskId: "sample-task-01",
    sampleOnly: true,
    totalRows: rawRows.length,
    completedCategories: firstCategory
      ? [{ tag: firstCategory.tag, name: firstCategory.parentName, completedAt: "2026-07-31T00:00:00.000Z" }]
      : [],
    activeCategory: rawRows.at(-1)?.category || null,
    seenKeys: rawRows.map((row) => `${row.category?.tag || "sample-category"}:${row.productRaw?.id}`)
  };
  const expectedAudit = auditSample({ rawRows, checkpoint, riskEvents });
  const summary = {
    sampleOnly: true,
    generatedAt: new Date().toISOString(),
    sourceDescription: "脱敏真实结构样例，不代表当前门店、账号或市场价格",
    audit: expectedAudit
  };

  await fs.mkdir(output, { recursive: true });
  await writeJsonAtomic(path.join(output, "capture.plan.json"), plan);
  await writeJsonl(path.join(output, "capture.progress.jsonl"), progress);
  await writeJsonAtomic(path.join(output, "capture.checkpoint.json"), checkpoint);
  await writeJsonl(path.join(output, "capture.products.raw.jsonl"), rawRows);
  await writeJsonAtomic(path.join(output, "capture.summary.json"), summary);
  await writeJsonl(path.join(output, "risk-events.jsonl"), riskEvents);
  await writeJsonAtomic(path.join(output, "expected-audit.json"), expectedAudit);
  await fs.writeFile(
    path.join(output, "README.md"),
    [
      "# 脱敏真实采集样例",
      "",
      "这些文件来自真实采集字段结构，身份、门店、路径、URL、请求标识和产品标识已稳定替换。",
      "商品名称、规格和价格仅用于离线演练，不代表当前市场状态，禁止直接入生产数据库。",
      "",
      "运行：",
      "",
      "```powershell",
      "node ../../scripts/handoff/replay-sample.mjs --package-root ../..",
      "```",
      ""
    ].join("\n"),
    "utf8"
  );

  const sampleText = (
    await Promise.all(
      (await listFilesRecursive(output)).map((file) => fs.readFile(path.join(output, file), "utf8"))
    )
  ).join("\n");
  const findings = scanText(sampleText, "examples/deidentified");
  if (findings.length) {
    throw new Error(`sample_redaction_failed:${JSON.stringify(findings)}`);
  }

  return {
    sourceRawFile: "<REDACTED_SOURCE_PATH>",
    rawRows: rawRows.length,
    progressRows: progress.length,
    riskEvents: riskEvents.length,
    expectedAudit
  };
}

async function selectRepresentativeRawRows(filePath) {
  const candidates = [];
  const seenSpu = new Set();
  const input = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const product = object(row?.productRaw);
    const spuId = text(product.id ?? product.spu_id ?? row?.productIndex?.spuId);
    if (!spuId || seenSpu.has(spuId)) continue;
    seenSpu.add(spuId);
    const skus = Array.isArray(product.skus) ? product.skus : [];
    const score =
      (skus.length > 1 ? 4 : 0) +
      (hasActivityPrice(row) ? 4 : 0) +
      (row?.category?.tag ? 1 : 0);
    candidates.push({ row, score, tag: text(row?.category?.tag) });
    if (candidates.length >= 2_000) break;
  }
  input.destroy();

  const selected = [];
  const selectedSpu = new Set();
  const selectedTags = new Set();
  const ordered = candidates.sort((left, right) => right.score - left.score);
  for (const candidate of ordered) {
    const product = object(candidate.row?.productRaw);
    const spuId = text(product.id ?? product.spu_id ?? candidate.row?.productIndex?.spuId);
    if (selectedSpu.has(spuId)) continue;
    if (selected.length >= 3 && selectedTags.has(candidate.tag)) continue;
    selected.push(candidate.row);
    selectedSpu.add(spuId);
    if (candidate.tag) selectedTags.add(candidate.tag);
    if (selected.length >= 5) break;
  }
  return selected;
}

async function findRiskEvent(sourceRoot, relativeFiles) {
  const progressFiles = relativeFiles.filter((file) => file.endsWith(".progress.jsonl"));
  for (const relativePath of progressFiles) {
    const input = createReadStream(path.join(sourceRoot, relativePath), { encoding: "utf8" });
    const reader = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.includes("request_error") && !line.includes("risk_pause")) continue;
      const row = JSON.parse(line);
      input.destroy();
      return row;
    }
  }
  return null;
}

function selectProgressRows(localRows, riskEvent) {
  const eventOrder = [
    "started",
    "page_state",
    "plan_ready",
    "category_start",
    "task_progress",
    "category_done"
  ];
  const selected = [];
  for (const event of eventOrder) {
    const row = localRows.find((candidate) => candidate?.event === event);
    if (row) selected.push(row);
  }
  if (riskEvent) selected.push(riskEvent);
  return selected;
}

function hasActivityPrice(row) {
  const product = object(row?.productRaw);
  const values = [product, ...(Array.isArray(product.skus) ? product.skus : [])];
  return values.some((value) => Number.isFinite(Number(value?.unify_price?.activity_info?.activity_price)));
}

function riskType(row) {
  const message = String(row?.err?.message || row?.message || "");
  if (message.includes("418")) return "http_418";
  if (message.includes("403")) return "http_403";
  return row?.event || "collection_risk";
}

function completedCategoryCount(checkpoint) {
  if (Array.isArray(checkpoint?.completedCategories)) return checkpoint.completedCategories.length;
  if (Array.isArray(checkpoint?.completedCategoryKeys)) return checkpoint.completedCategoryKeys.length;
  if (checkpoint?.completedCategories && typeof checkpoint.completedCategories === "object") {
    return Object.keys(checkpoint.completedCategories).length;
  }
  return 0;
}

function firstPrice(...items) {
  for (const item of items) {
    const candidates = [
      item?.frontDisplayPrice,
      item?.unify_price?.activity_info?.activity_price,
      item?.min_price,
      item?.price,
      item?.unify_price?.price
    ];
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    }
  }
  return null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}
