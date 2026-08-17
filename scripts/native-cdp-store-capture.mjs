import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { connectToCdpPage } from "./lib/cdp-page-session.mjs";
import { selectTaskCategories } from "./lib/category-selection.mjs";
import {
  categoryCompletionFromEvidence,
  categoryDurableProductIdsFromSeenKeys,
  durableProductIdsFromSeenKeys,
  isDurablyCompletedCategoryEvent,
  mergeCheckpointState,
  missingDurableProductIds,
  requiresPageFallback
} from "./lib/capture-checkpoint.mjs";

const config = loadConfig();
fs.mkdirSync(config.outputDir, { recursive: true });

const files = {
  raw: path.join(config.outputDir, `${config.captureId}.products.raw.jsonl`),
  categories: path.join(config.outputDir, `${config.captureId}.categories.jsonl`),
  progress: path.join(config.outputDir, `${config.captureId}.progress.jsonl`),
  summary: path.join(config.outputDir, `${config.captureId}.summary.json`),
  checkpoint: path.join(config.outputDir, `${config.captureId}.checkpoint.json`)
};

const checkpoint = loadCheckpoint(files.checkpoint);
const seenKeys = new Set(checkpoint.seenKeys || []);
const durableProductIds = durableProductIdsFromSeenKeys(checkpoint.seenKeys || []);
const completedCategoryKeys = new Set(loadCompletedCategoryKeys(files.categories));
let totalRows = Number(checkpoint.totalRows || 0);
let totalUniqueSpu = Number(checkpoint.totalUniqueSpu || 0);
let requestCount = Number(checkpoint.requestCount || 0);
let riskCount = Number(checkpoint.riskCount || 0);
let adaptiveObservedChunkSize = config.observedSmoothChunkSize;

function loadConfig() {
  const cursor = parseJsonEnv("MT_TASK_CURSOR_JSON", {});
  const outputDir = path.resolve(process.env.MT_OUTPUT_DIR || path.join(process.cwd(), ".runtime", "native-capture"));
  const cdpEndpoint = process.env.MT_CDP_ENDPOINT || `http://127.0.0.1:${process.env.MT_CDP_PORT || "9223"}`;
  const runId =
    process.env.MT_RUN_ID ||
    `native-${process.env.MT_WORKER_ID || "worker"}-${process.env.MT_TASK_ID || Date.now()}`;
  const captureId = process.env.MT_CAPTURE_ID || runId;

  return {
    cdpEndpoint,
    cdpPort: Number(process.env.MT_CDP_PORT || new URL(cdpEndpoint).port || 9223),
    targetUrlPart: process.env.MT_TARGET_URL_PART || cursor.targetUrlPart || "",
    runId,
    captureId,
    outputDir,
    workerId: process.env.MT_WORKER_ID || "",
    taskId: process.env.MT_TASK_ID || "",
    storeId: process.env.MT_STORE_ID || "",
    storeName: process.env.MT_STORE_NAME || "",
    accountId: process.env.MT_ACCOUNT_ID || "",
    accountLabel: process.env.MT_ACCOUNT_LABEL || "",
    profileId: process.env.MT_PROFILE_ID || "",
    profilePath: process.env.MT_PROFILE_PATH || "",
    categoryNames: csv(process.env.MT_CATEGORY_NAMES || ""),
    captureAllCategories: (process.env.MT_CAPTURE_ALL_CATEGORIES || "false") === "true",
    categoryTag: process.env.MT_CATEGORY_TAG || cursor.categoryTag || "",
    categoryTags: csv(process.env.MT_CATEGORY_TAGS || String(cursor.categoryTags || "")),
    categoryI: integerFrom(process.env.MT_CATEGORY_I ?? cursor.categoryI),
    categoryJ: integerFrom(process.env.MT_CATEGORY_J ?? cursor.categoryJ),
    startCategoryI: integerFrom(process.env.MT_START_CATEGORY_I ?? cursor.startCategoryI),
    endCategoryI: integerFrom(process.env.MT_END_CATEGORY_I ?? cursor.endCategoryI),
    maxCategories: integerFrom(process.env.MT_MAX_CATEGORIES ?? cursor.maxCategories),
    skipCategoryIs: new Set(csv(process.env.MT_SKIP_CATEGORY_IS || String(cursor.skipCategoryIs || "")).map(Number).filter(Number.isFinite)),
    expectedItems: integerFrom(process.env.MT_EXPECTED_ITEMS ?? cursor.expectedItems),
    cursor,
    requestDelayMinMs: integerFrom(process.env.MT_DELAY_MIN_MS) ?? 45_000,
    requestDelayMaxMs: integerFrom(process.env.MT_DELAY_MAX_MS) ?? 120_000,
    categoryRestMinMs: integerFrom(process.env.MT_CATEGORY_REST_MIN_MS) ?? 90_000,
    categoryRestMaxMs: integerFrom(process.env.MT_CATEGORY_REST_MAX_MS) ?? 240_000,
    riskSleepMs: integerFrom(process.env.MT_RISK_SLEEP_MS) ?? 3_600_000,
    maxRiskRetries: integerFrom(process.env.MT_RISK_RETRIES) ?? 99,
    observedSmoothChunkSize:
      integerFrom(process.env.MT_OBSERVED_SMOOTH_CHUNK_SIZE ?? cursor.observedSmoothChunkSize) ?? 30,
    minSmoothChunkSize: integerFrom(process.env.MT_MIN_SMOOTH_CHUNK_SIZE) ?? 8,
    dynamicMode: process.env.MT_DYNAMIC_CHUNK_MODE || "balanced",
    allowPageFallback: (process.env.MT_ALLOW_PAGE_FALLBACK || "false") === "true",
    stopFile: path.resolve(process.env.MT_STOP_FILE || path.join(outputDir, `${captureId}.stop`)),
    riskResumeFile: path.resolve(process.env.MT_RISK_RESUME_FILE || path.join(outputDir, `${captureId}.risk-resume.ok`))
  };
}

function parseJsonEnv(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function csv(value) {
  return value
    .split(/[,，|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function integerFrom(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function nowIso() {
  return new Date().toISOString();
}

function append(file, row) {
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
}

function emit(event, details = {}) {
  const row = {
    ts: nowIso(),
    runId: config.runId,
    captureId: config.captureId,
    taskId: config.taskId,
    workerId: config.workerId,
    event,
    ...details
  };
  append(files.progress, row);
  console.log(JSON.stringify(row));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(low + Math.random() * Math.max(1, high - low));
}

function loadCheckpoint(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function categoryKey(category) {
  const tag = String(category?.tag || "").trim();
  if (tag) return `tag:${tag}`;
  return `name:${displayCategoryName(category)}`;
}

function loadCompletedCategoryKeys(file) {
  if (!fs.existsSync(file)) return [];
  const completed = new Set();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (isDurablyCompletedCategoryEvent(event)) {
        completed.add(categoryKey(event.category));
      }
    } catch {
      // A partial trailing JSONL line must not invalidate earlier durable events.
    }
  }
  return [...completed];
}

function saveCheckpoint(extra = {}) {
  const state = mergeCheckpointState(checkpoint, {
    runId: config.runId,
    captureId: config.captureId,
    taskId: config.taskId,
    updatedAt: nowIso(),
    totalRows,
    totalUniqueSpu,
    requestCount,
    riskCount,
    adaptiveObservedChunkSize,
    seenKeys: [...seenKeys],
    completedCategoryKeys: [...completedCategoryKeys],
    ...extra
  });
  Object.assign(checkpoint, state);
  fs.writeFileSync(files.checkpoint, JSON.stringify(state, null, 2), "utf8");
}

function productId(product) {
  return (
    product?.id ??
    product?.spu_id ??
    product?.spuId ??
    product?.wm_food_spu_id ??
    product?.spuIdStr ??
    product?.spu_id_str ??
    product?.name
  );
}

function productName(product) {
  return product?.name || product?.spu_name || product?.sku_name || "";
}

function skuId(sku) {
  return sku?.id ?? sku?.sku_id ?? sku?.skuId ?? sku?.wm_food_sku_id ?? "";
}

function extractProductIndex(product) {
  const skus = Array.isArray(product?.skus)
    ? product.skus.map((sku) => ({
        skuId: skuId(sku),
        spec: sku?.spec || sku?.name || sku?.sku_name || "",
        price: sku?.price ?? sku?.min_price ?? sku?.activity_price ?? "",
        originPrice: sku?.origin_price ?? sku?.originPrice ?? "",
        frontDisplayPrice: frontDisplayPrice(sku),
        frontDisplayPriceStr: sku?.unify_price?.activity_info?.activity_price_str ?? "",
        frontDisplayPriceSuffix: sku?.unify_price?.activity_info?.activity_price_suffix ?? "",
        basePrice: sku?.unify_price?.price ?? sku?.origin_price ?? sku?.price ?? "",
        underlinedPrice:
          sku?.unify_price?.underlined_price ??
          sku?.unify_price?.activity_info?.underline_price ??
          sku?.origin_price ??
          "",
        quotaPerOrder: sku?.unify_price?.activity_info?.quota_per_order ?? "",
        activityType: sku?.unify_price?.activity_info?.activity_type ?? sku?.activity_type_for_spu ?? "",
        promotionInfo: cleanText(sku?.promotion_info || ""),
        stock: sku?.stock ?? sku?.real_stock ?? sku?.activity_stock ?? "",
        status: sku?.status ?? ""
      }))
    : [];
  return {
    spuId: productId(product),
    name: productName(product),
    minPrice: product?.min_price ?? product?.price ?? "",
    originPrice: product?.origin_price ?? product?.originPrice ?? "",
    frontDisplayPrice: frontDisplayPrice(product),
    frontDisplayPriceStr: product?.unify_price?.activity_info?.activity_price_str ?? "",
    frontDisplayPriceSuffix: product?.unify_price?.activity_info?.activity_price_suffix ?? "",
    frontDisplayPriceSource: priceSource(product),
    basePrice: product?.unify_price?.price ?? product?.origin_price ?? product?.min_price ?? "",
    underlinedPrice:
      product?.unify_price?.underlined_price ??
      product?.unify_price?.activity_info?.underline_price ??
      product?.origin_price ??
      "",
    quotaPerOrder: product?.unify_price?.activity_info?.quota_per_order ?? "",
    activityType: product?.unify_price?.activity_info?.activity_type ?? product?.activity_type ?? "",
    promotionInfo: cleanText(product?.promotion_info || ""),
    unit: product?.unit || "",
    picture: product?.picture || product?.pic_url || product?.picture_url || "",
    monthSaledContent: product?.month_saled_content || "",
    skus
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;
}

function validPrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function frontDisplayPrice(item) {
  const activityPrice = item?.unify_price?.activity_info?.activity_price;
  if (validPrice(activityPrice)) return activityPrice;
  const minPrice = item?.min_price;
  if (validPrice(minPrice)) return minPrice;
  const skuPrice = item?.price;
  if (validPrice(skuPrice)) return skuPrice;
  const unifyPrice = item?.unify_price?.price;
  if (validPrice(unifyPrice)) return unifyPrice;
  return "";
}

function priceSource(item) {
  if (validPrice(item?.unify_price?.activity_info?.activity_price)) return "unify_price.activity_info.activity_price";
  if (validPrice(item?.min_price)) return "min_price";
  if (validPrice(item?.price)) return "sku.price";
  if (validPrice(item?.unify_price?.price)) return "unify_price.price";
  return "";
}

function writeProducts(source, category, products) {
  let wrote = 0;
  for (const product of products || []) {
    const id = productId(product);
    if (!id) continue;
    const key = `${category.i}:${category.j}:${id}`;
    const durableId = String(id);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    durableProductIds.add(durableId);
    wrote += 1;
    totalRows += 1;
    append(files.raw, {
      ts: nowIso(),
      runId: config.runId,
      captureId: config.captureId,
      taskId: config.taskId,
      source,
      worker: {
        workerId: config.workerId
      },
      account: {
        accountId: config.accountId,
        accountLabel: config.accountLabel,
        profileId: config.profileId,
        profilePath: config.profilePath,
        cdpPort: config.cdpPort
      },
      store: {
        storeId: config.storeId,
        storeName: config.storeName
      },
      category: normalizeCategoryForOutput(category),
      productIndex: extractProductIndex(product),
      productRaw: product
    });
  }
  totalUniqueSpu = durableProductIds.size;
  return wrote;
}

function normalizeCategoryForOutput(category) {
  return {
    i: category.i,
    j: category.j,
    parentName: category.parentName || "",
    name: category.name || "",
    displayName: displayCategoryName(category),
    tag: category.tag || "",
    type: category.type,
    productCount: category.product_count || category.productCount || 0,
    syntheticAll: category.syntheticAll === true
  };
}

function displayCategoryName(category) {
  if (category.parentName && category.name && category.parentName !== category.name) {
    return `${category.parentName}/${category.name}`;
  }
  return category.name || category.parentName || "";
}

function jsString(value) {
  return JSON.stringify(String(value ?? ""));
}

async function connectToPage() {
  return connectToCdpPage({
    cdpEndpoint: config.cdpEndpoint,
    targetUrlPart: config.targetUrlPart
  });
}

async function pageState(evaluate) {
  return evaluate(`(() => {
    const p = typeof getCurrentPages === 'function' ? getCurrentPages().at?.(-1) : null;
    const state = typeof getApp === 'function' ? getApp()?.Adapter?.getStore?.().getState?.() : null;
    const tags = state?.poi?.food_spu_tags || [];
    const text = String(document.body?.innerText || '').slice(0, 500);
    return {
      title: document.title,
      url: location.href,
      route: p?.route || '',
      poiName: p?.data?.poiInfo?.name || p?.data?.poiName || '',
      tagCount: tags.length,
      text
    };
  })()`);
}

async function methodInfo(evaluate) {
  return evaluate(`(() => {
    const p = typeof getCurrentPages === 'function' ? getCurrentPages().at?.(-1) : null;
    const src = {
      requestSmoothSpus: String(p?.requestSmoothSpus || ''),
      requestSpusAndSortedIds: String(p?.requestSpusAndSortedIds || ''),
      getCachedData: String(p?._getCachedData || '')
    };
    const smoothCaps = [...src.requestSmoothSpus.matchAll(/[A-Za-z_$][\\w$]*\\.length\\s*>\\s*(\\d+)/g)]
      .map((match) => Number(match[1]))
      .filter(Number.isFinite);
    const smoothCap = smoothCaps.length ? Math.max(...smoothCaps) : 50;
    return {
      hasPage: !!p,
      hasRequestSmoothSpus: typeof p?.requestSmoothSpus === 'function',
      hasRequestSpusAndSortedIds: typeof p?.requestSpusAndSortedIds === 'function',
      hasGetCachedData: typeof p?._getCachedData === 'function',
      smoothCap,
      sourceHash: {
        requestSmoothSpus: src.requestSmoothSpus.length,
        requestSpusAndSortedIds: src.requestSpusAndSortedIds.length,
        getCachedData: src.getCachedData.length
      }
    };
  })()`);
}

async function getPlan(evaluate) {
  return evaluate(`(() => {
    const tags = getApp().Adapter.getStore().getState().poi.food_spu_tags || [];
    function info(t, i, j = -1, parentName = '') {
      return {
        i,
        j,
        parentName,
        name: t?.name || '',
        tag: String(t?.tag || ''),
        type: t?.type,
        product_count: t?.product_count || 0,
        spus: Array.isArray(t?.spus) ? t.spus.length : 0,
        all: Array.isArray(t?.allSortedSpuId) ? t.allSortedSpuId.length : null,
        has_next_page: !!t?.has_next_page,
        current_page: t?.current_page
      };
    }
    function activityMeta(t) {
      return {
        tag: String(t?.tag || ''),
        name: t?.name || '',
        type: t?.type,
        product_count: t?.product_count || 0,
        activity_tag: t?.activity_tag || '',
        sub_name: t?.sub_name || '',
        activity_info: t?.activity_info || null,
        receive_coupon_tip: t?.receive_coupon_tip || null
      };
    }
    const plan = [];
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      const sub = Array.isArray(t.tags) ? t.tags : [];
      if (sub.length) {
        if (t?.aggregationActivityTags === true) {
          const activityChildren = sub.map(activityMeta);
          const productChildren = sub
            .map((child, j) => ({ child, j }))
            .filter(({ child }) => Number(child?.product_count || 0) > 0);
          for (const { child, j } of productChildren) {
            const entry = info(child, i, j, t.name);
            entry.parentActivity = activityMeta(t);
            entry.activityChildren = activityChildren;
            plan.push(entry);
          }
          if (!productChildren.length) {
            const entry = info(t, i, -1, t.name);
            entry.metadataOnly = true;
            entry.activityChildren = activityChildren;
            plan.push(entry);
          }
          continue;
        }
        const allIdx = sub.findIndex((x) => x && (x.name === '全部' || String(x.tag || '').endsWith('_27')));
        if (allIdx >= 0) {
          plan.push(info(sub[allIdx], i, allIdx, t.name));
        } else {
          const parentTag = String(t?.tag || '');
          const syntheticAll = info(
            {
              name: '全部',
              tag: parentTag.endsWith('_27') ? parentTag : parentTag + '_27',
              type: 27,
              product_count: t?.product_count || 0
            },
            i,
            0,
            t.name
          );
          syntheticAll.syntheticAll = true;
          plan.push(syntheticAll);
        }
      } else {
        plan.push(info(t, i, -1, t?.name || ''));
      }
    }
    return { count: plan.length, plan };
  })()`);
}

async function readCategory(evaluate, i, j) {
  return evaluate(`(() => {
    const p = getCurrentPages().at(-1);
    const d = p._getCachedData(${Number(i)}, ${Number(j)});
    return {
      i: ${Number(i)},
      j: ${Number(j)},
      name: d?.name || '',
      tag: String(d?.tag || ''),
      type: d?.type,
      product_count: d?.product_count || 0,
      current_page: d?.current_page,
      has_next_page: !!d?.has_next_page,
      allSortedSpuId: Array.isArray(d?.allSortedSpuId) ? d.allSortedSpuId : [],
      spus: (Array.isArray(d?.spus) ? d.spus : []).map((x) => x)
    };
  })()`);
}

async function requestPage(evaluate, category, pageIndex) {
  return evaluate(`(async () => {
    const p = getCurrentPages().at(-1);
    let err = null;
    let ret = [];
    try {
      ret = await p.requestSpusAndSortedIds(
        ${Number(category.i)},
        ${Number(category.j)},
        ${jsString(category.tag)},
        ${Number(category.type)},
        ${Number(pageIndex)},
        false
      );
    } catch (e) {
      err = {
        message: e?.message || String(e),
        code: e?.code || '',
        status: e?.status || '',
        httpStatus: e?.httpStatus || ''
      };
    }
    const d = p._getCachedData(${Number(category.i)}, ${Number(category.j)});
    return {
      ok: !err,
      err,
      retLen: Array.isArray(ret) ? ret.length : null,
      category: {
        name: d?.name || '',
        tag: String(d?.tag || ''),
        type: d?.type,
        product_count: d?.product_count || 0,
        current_page: d?.current_page,
        has_next_page: !!d?.has_next_page,
        allLen: Array.isArray(d?.allSortedSpuId) ? d.allSortedSpuId.length : null,
        spuLen: Array.isArray(d?.spus) ? d.spus.length : null
      },
      products: Array.isArray(ret) ? ret : []
    };
  })()`);
}

async function requestSmooth(evaluate, category, ids) {
  const arr = JSON.stringify(ids.map(Number).filter(Boolean));
  return evaluate(`(async () => {
    const p = getCurrentPages().at(-1);
    let err = null;
    try {
      await p.requestSmoothSpus(
        ${arr},
        ${Number(category.i)},
        ${Number(category.j)},
        ${jsString(category.tag)},
        ${Number(category.type)},
        {},
        true
      );
    } catch (e) {
      err = {
        message: e?.message || String(e),
        code: e?.code || '',
        status: e?.status || '',
        httpStatus: e?.httpStatus || ''
      };
    }
    const d = p._getCachedData(${Number(category.i)}, ${Number(category.j)});
    const wanted = new Set(${arr}.map(String));
    const products = (Array.isArray(d?.spus) ? d.spus : []).filter((x) =>
      wanted.has(String(x?.id ?? x?.spu_id ?? x?.spuId))
    );
    return {
      ok: !err,
      err,
      category: {
        name: d?.name || '',
        tag: String(d?.tag || ''),
        type: d?.type,
        product_count: d?.product_count || 0,
        current_page: d?.current_page,
        has_next_page: !!d?.has_next_page,
        allLen: Array.isArray(d?.allSortedSpuId) ? d.allSortedSpuId.length : null,
        spuLen: Array.isArray(d?.spus) ? d.spus.length : null
      },
      products
    };
  })()`);
}

function isRiskError(err) {
  const fields = [
    err?.message,
    err?.code,
    err?.status,
    err?.httpStatus,
    err?.responseCode,
    err?.response_code
  ]
    .filter(Boolean)
    .join(" ");
  return /403|418|验证码|身份|核实|登录|授权码|风控|captcha|verify|yoda/i.test(fields);
}

function isRiskPage(state) {
  const titleUrl = [state?.title, state?.url].filter(Boolean).join(" ");
  if (/403|418|验证码|身份|核实|登录|授权码|verify|captcha|yoda/i.test(titleUrl)) return true;

  if (state?.poiName && Number(state?.tagCount) > 0) return false;

  const text = String(state?.text || "");
  return /403|418|验证码|身份核实|身份验证|请.{0,6}登录|重新登录|登录.{0,6}失效|授权码|请求异常|访问异常|拒绝操作|verify|captcha|yoda/i.test(text);
}

async function guardedRequest(label, fn) {
  for (;;) {
    if (fs.existsSync(config.stopFile)) {
      throw new Error(`stop file exists: ${config.stopFile}`);
    }
    const result = await fn();
    requestCount += 1;
    if (result?.ok !== false) return result;

    emit("request_error", {
      label,
      err: result.err,
      requestCount,
      risk: isRiskError(result.err)
    });

    if (!isRiskError(result.err)) return result;
    riskCount += 1;
    if (riskCount > config.maxRiskRetries) throw new Error(`risk retry exceeded at ${label}`);
    emit("risk_pause", {
      label,
      err: result.err,
      requestCount,
      riskSleepMs: config.riskSleepMs,
      resumeFile: config.riskResumeFile
    });
    await waitForManualResume();
  }
}

async function waitForManualResume() {
  const started = Date.now();
  while (Date.now() - started < config.riskSleepMs) {
    if (fs.existsSync(config.stopFile)) throw new Error(`stop file exists: ${config.stopFile}`);
    if (fs.existsSync(config.riskResumeFile)) {
      fs.rmSync(config.riskResumeFile, { force: true });
      emit("risk_pause_resumed", { resumeFile: config.riskResumeFile });
      return;
    }
    await sleep(10_000);
  }
  emit("risk_pause_sleep_elapsed", { sleepMs: config.riskSleepMs });
}

function computeChunkSize({ remaining, methodCap }) {
  const healthLimit =
    config.dynamicMode === "conservative"
      ? Math.min(adaptiveObservedChunkSize, 20)
      : config.dynamicMode === "fast"
        ? adaptiveObservedChunkSize
        : Math.min(adaptiveObservedChunkSize, 30);
  const base = Math.max(config.minSmoothChunkSize, Math.min(healthLimit, methodCap || 50));
  return Math.max(1, Math.min(remaining, base));
}

async function main() {
  emit("started", {
    cdpEndpoint: config.cdpEndpoint,
    cdpPort: config.cdpPort,
    storeId: config.storeId,
    storeName: config.storeName,
    categoryNames: config.categoryNames,
    categoryTag: config.categoryTag,
    outputDir: config.outputDir,
    rawFile: files.raw,
    checkpointFile: files.checkpoint,
    strategy: "native-page-runtime-cache-and-missing-id-smooth-fill",
    notificationPolicy: "risk-only-in-script; run milestones handled by master"
  });

  const { page, evaluate, close } = await connectToPage();
  try {
    await ensureUsablePage(evaluate, page);

    const methods = await methodInfo(evaluate);
    emit("method_info", methods);
    if (!methods.hasRequestSmoothSpus || !methods.hasRequestSpusAndSortedIds || !methods.hasGetCachedData) {
      throw new Error("当前页面缺少必要的页面运行时函数");
    }

    const planObj = await getPlan(evaluate);
    const planFile = path.join(config.outputDir, `${config.captureId}.plan.json`);
    fs.writeFileSync(planFile, JSON.stringify(planObj, null, 2), "utf8");
    emit("plan_ready", { categoryTasks: planObj.count, planFile });

    const selectedCategories = selectTaskCategories(planObj.plan, config);
    if (selectedCategories.length && config.categoryI !== undefined && selectedCategories[0].i !== config.categoryI) {
      emit("category_identity_drift", {
        requested: { i: config.categoryI, j: config.categoryJ, tag: config.categoryTag, names: config.categoryNames },
        selected: normalizeCategoryForOutput(selectedCategories[0])
      });
    }
    const categories = selectedCategories.filter(
      (category) => !completedCategoryKeys.has(categoryKey(category))
    );
    emit("task_categories_selected", {
      selected: categories.map((category) => normalizeCategoryForOutput(category)),
      skippedByCheckpoint: selectedCategories.length - categories.length
    });
    if (!selectedCategories.length) {
      const reason = `当前 Profile 页面运行态未匹配到任务类目 categoryNames=${config.categoryNames.join("|")} tag=${config.categoryTag} i=${config.categoryI} j=${config.categoryJ}`;
      append(files.categories, {
        ts: nowIso(),
        runId: config.runId,
        captureId: config.captureId,
        event: "category_unavailable",
        reason,
        requested: {
          categoryNames: config.categoryNames,
          categoryTag: config.categoryTag,
          categoryI: config.categoryI,
          categoryJ: config.categoryJ
        }
      });
      emit("category_unavailable", {
        reason,
        categoryNames: config.categoryNames,
        categoryTag: config.categoryTag,
        categoryI: config.categoryI,
        categoryJ: config.categoryJ
      });
      saveCheckpoint({ skipped: true, skippedReason: reason });
      const summary = buildSummary("skipped");
      summary.skippedReason = reason;
      emit("finished", summary);
      writeFinalSummary(summary);
      return;
    }
    if (!categories.length) {
      const summary = buildSummary("completed");
      summary.resumedFromCompletedCheckpoint = true;
      emit("finished", summary);
      writeFinalSummary(summary);
      return;
    }

    const categoryResults = [];
    for (const category0 of categories) {
      categoryResults.push(await captureCategory(evaluate, methods, category0));
      await sleep(rand(config.categoryRestMinMs, config.categoryRestMaxMs));
    }

    const incompleteCategories = categoryResults.filter((result) => !result.completed);
    const summary = buildSummary(incompleteCategories.length ? "incomplete" : "completed");
    if (incompleteCategories.length) {
      summary.error = `category_incomplete:${incompleteCategories
        .map((result) => `${result.category}:${result.finalSpus}/${result.finalAll}`)
        .join(",")}`;
      summary.incompleteCategories = incompleteCategories;
    }
    emit("finished", summary);
    writeFinalSummary(summary);
  } finally {
    close();
  }
}

async function ensureUsablePage(evaluate, page) {
  let runtimeWaitAttempts = 0;
  for (;;) {
    const state = await pageState(evaluate);
    const hasUsableStoreRuntime = !!state?.poiName && Number(state?.tagCount) > 0;
    const riskPage = hasUsableStoreRuntime ? false : isRiskPage(state);
    emit("page_state", {
      pageTitle: page.title,
      title: state.title,
      url: state.url,
      poiName: state.poiName,
      tagCount: state.tagCount,
      route: state.route,
      hasUsableStoreRuntime,
      riskPage
    });
    if (hasUsableStoreRuntime) return state;
    if (!riskPage && runtimeWaitAttempts < 12) {
      runtimeWaitAttempts += 1;
      emit("page_runtime_wait", {
        attempt: runtimeWaitAttempts,
        maxAttempts: 12,
        title: state.title,
        url: state.url
      });
      await sleep(5_000);
      continue;
    }

    riskCount += 1;
    if (riskCount > config.maxRiskRetries) {
      throw new Error(`risk page retry exceeded: ${state.title} ${state.url}`);
    }
    emit("risk_pause", {
      label: "page_state",
      err: {
        message: `当前页面疑似风险/登录/验证页: ${state.title} ${state.url}`
      },
      requestCount,
      riskSleepMs: config.riskSleepMs,
      resumeFile: config.riskResumeFile
    });
    await waitForManualResume();
  }
}

async function captureCategory(evaluate, methods, category0) {
  let category = { ...category0 };
  const categoryLabel = displayCategoryName(category);
  append(files.categories, { ts: nowIso(), runId: config.runId, captureId: config.captureId, event: "category_start", category });
  emit("category_start", { category: normalizeCategoryForOutput(category) });

  let categoryDurableProductIds = categoryDurableProductIdsFromSeenKeys(seenKeys, category);

  saveCheckpoint({
    currentCategory: normalizeCategoryForOutput(category),
    categoryCompleted: false,
    remainingMissing: null,
    failed: false,
    error: null
  });

  let cached = await readCategory(evaluate, category.i, category.j);
  category = mergeCategory(category, cached);
  const cacheWrote = writeProducts("cache_before", category, cached.spus || []);
  if (cacheWrote) {
    emit("products_written", {
      source: "cache_before",
      category: displayCategoryName(category),
      wrote: cacheWrote,
      totalRows,
      totalUniqueSpu
    });
  }

  if (!Array.isArray(cached.allSortedSpuId) || cached.allSortedSpuId.length === 0 || (cached.spus || []).length === 0) {
    await sleep(rand(config.requestDelayMinMs, config.requestDelayMaxMs));
    const page0 = await guardedRequest(`page0:${categoryLabel}`, () => requestPage(evaluate, category, 0));
    if (page0?.ok === false) {
      emit("category_request_failed", { category: categoryLabel, err: page0.err });
      return {
        category: categoryLabel,
        finalSpus: Array.isArray(cached.spus) ? cached.spus.length : 0,
        finalAll: Array.isArray(cached.allSortedSpuId) ? cached.allSortedSpuId.length : 0,
        completed: false,
        error: page0.err?.message || "category request failed"
      };
    }
    category = mergeCategory(category, page0.category);
    const wrote = writeProducts("page0", category, page0.products || []);
    emit("page0_done", {
      category: displayCategoryName(category),
      retLen: page0.retLen,
      wrote,
      productCount: category.product_count,
      allLen: page0.category.allLen,
      totalRows,
      totalUniqueSpu,
      requestCount
    });
    cached = await readCategory(evaluate, category.i, category.j);
  }

  const allIds = Array.isArray(cached.allSortedSpuId) ? cached.allSortedSpuId.map(Number).filter(Boolean) : [];
  const expected = Math.max(
    allIds.length,
    Number(cached.product_count || 0),
    Number(category.product_count || 0),
    Number(config.expectedItems || 0)
  );
  categoryDurableProductIds = categoryDurableProductIdsFromSeenKeys(seenKeys, category);
  let missing = missingDurableProductIds(allIds, categoryDurableProductIds).map(Number).filter(Boolean);
  let missingCount = allIds.length
    ? missing.length
    : Math.max(0, expected - categoryDurableProductIds.size);
  emit("category_gap", {
    category: displayCategoryName(category),
    expected,
    productCount: cached.product_count || category.product_count,
    allIds: allIds.length,
    cachedSpus: (cached.spus || []).length,
    missing: missingCount
  });
  saveCheckpoint({
    currentCategory: normalizeCategoryForOutput(category),
    categoryCompleted: false,
    remainingMissing: missingCount
  });

  while (missing.length) {
    const chunkSize = computeChunkSize({ remaining: missing.length, methodCap: methods.smoothCap });
    const chunk = missing.slice(0, chunkSize);
    await sleep(rand(config.requestDelayMinMs, config.requestDelayMaxMs));
    const smooth = await guardedRequest(`smooth:${displayCategoryName(category)}:${chunk.length}`, () =>
      requestSmooth(evaluate, category, chunk)
    );
    if (smooth?.ok === false) {
      emit("smooth_failed", { category: displayCategoryName(category), err: smooth.err });
      break;
    }

    const returned = (smooth.products || []).length;
    if (returned > 0 && chunk.length >= adaptiveObservedChunkSize && returned < chunk.length) {
      adaptiveObservedChunkSize = Math.max(config.minSmoothChunkSize, returned);
    }
    const wrote = writeProducts("smooth_missing_ids", category, smooth.products || []);
    cached = await readCategory(evaluate, category.i, category.j);
    categoryDurableProductIds = categoryDurableProductIdsFromSeenKeys(seenKeys, category);
    missing = missingDurableProductIds(allIds, categoryDurableProductIds).map(Number).filter(Boolean);
    emit("smooth_chunk_done", {
      category: displayCategoryName(category),
      requested: chunk.length,
      returned,
      wrote,
      remainingMissing: missing.length,
      adaptiveObservedChunkSize,
      totalRows,
      totalUniqueSpu,
      requestCount
    });
    emitTaskProgress(category, expected, allIds.length - missing.length);
    saveCheckpoint({
      currentCategory: normalizeCategoryForOutput(category),
      categoryCompleted: false,
      remainingMissing: missing.length
    });

    if (returned === 0) break;
  }

  if (
    config.allowPageFallback &&
    requiresPageFallback({
      allIds,
      expected,
      durableCount: categoryDurableProductIds.size
    })
  ) {
    await pageFallback(evaluate, category, missing, expected);
    cached = await readCategory(evaluate, category.i, category.j);
    categoryDurableProductIds = categoryDurableProductIdsFromSeenKeys(seenKeys, category);
    missing = missingDurableProductIds(allIds, categoryDurableProductIds).map(Number).filter(Boolean);
  }

  const finalCached = await readCategory(evaluate, category.i, category.j);
  writeProducts("cache_final", category, Array.isArray(finalCached.spus) ? finalCached.spus : []);
  const finalObservedSpuIds = [...new Set((finalCached.allSortedSpuId || []).map(String).filter(Boolean))];
  categoryDurableProductIds = categoryDurableProductIdsFromSeenKeys(seenKeys, category);
  const completion = categoryCompletionFromEvidence({
    observedAllSpuIds: finalObservedSpuIds,
    durableCapturedSpuIds: categoryDurableProductIds,
    expected
  });
  const {
    finalAll,
    finalSpus,
    missingSpuIds: finalMissingSpuIds,
    missingCount: finalMissingCount,
    completed
  } = completion;
  if (completed) completedCategoryKeys.add(categoryKey(category));
  append(files.categories, {
    ts: nowIso(),
    runId: config.runId,
    captureId: config.captureId,
    event: "category_done",
    account: {
      accountId: config.accountId,
      accountLabel: config.accountLabel,
      profileId: config.profileId,
      cdpPort: config.cdpPort
    },
    category,
    final: {
      finalSpus,
      finalAll,
      expected,
      missingCount: finalMissingCount,
      completed,
      totalRows,
      totalUniqueSpu,
      requestCount
    },
    evidence: {
      accountId: config.accountId,
      observedAllSpuIds: finalObservedSpuIds,
      durableCapturedSpuIds: [...categoryDurableProductIds],
      missingSpuIds: finalMissingSpuIds
    }
  });
  emit("category_done", {
    category: displayCategoryName(category),
    finalSpus,
    finalAll,
    expected,
    missing: finalMissingCount,
    completed,
    totalRows,
    totalUniqueSpu,
    requestCount
  });
  emitTaskProgress(category, expected, finalSpus);
  saveCheckpoint({
    currentCategory: normalizeCategoryForOutput(category),
    categoryCompleted: completed,
    remainingMissing: finalMissingCount,
    failed: false,
    error: null
  });
  return {
    category: displayCategoryName(category),
    finalSpus,
    finalAll,
    completed
  };
}

async function pageFallback(evaluate, category, missing, productCount) {
  const pages = Math.ceil(productCount / 20);
  emit("page_fallback_start", {
    category: displayCategoryName(category),
    missing: missing.length,
    pages
  });
  for (let pageIndex = 1; pageIndex < pages; pageIndex += 1) {
    await sleep(rand(config.requestDelayMinMs, config.requestDelayMaxMs));
    const result = await guardedRequest(`page:${displayCategoryName(category)}:${pageIndex}`, () =>
      requestPage(evaluate, category, pageIndex)
    );
    if (result?.ok === false) {
      emit("page_fallback_failed", { category: displayCategoryName(category), pageIndex, err: result.err });
      break;
    }
    const wrote = writeProducts(`page${pageIndex}`, category, result.products || []);
    emit("page_fallback_done", {
      category: displayCategoryName(category),
      pageIndex,
      retLen: result.retLen,
      wrote,
      totalRows,
      totalUniqueSpu,
      requestCount
    });
  }
}

function emitTaskProgress(category, expected, collected) {
  const boundedCollected = expected ? Math.min(expected, Math.max(0, collected)) : collected;
  emit("task_progress", {
    category: displayCategoryName(category),
    expectedItems: expected,
    collectedItems: boundedCollected,
    percent: expected ? Math.round((boundedCollected / expected) * 10_000) / 100 : null,
    totalRows,
    totalUniqueSpu,
    requestCount
  });
}

function mergeCategory(base, update) {
  if (base.syntheticAll === true) {
    return {
      ...base,
      product_count: update.product_count || update.productCount || base.product_count || 0
    };
  }
  return {
    ...base,
    name: update.name || base.name,
    tag: update.tag || base.tag,
    type: update.type ?? base.type,
    product_count: update.product_count || update.productCount || base.product_count || 0
  };
}

function buildSummary(status) {
  const artifactChecksums = {};
  for (const [kind, file] of Object.entries(files)) {
    if (!fs.existsSync(file) || kind === "summary") continue;
    artifactChecksums[kind] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  return {
    runId: config.runId,
    captureId: config.captureId,
    taskId: config.taskId,
    status,
    finishedAt: nowIso(),
    storeId: config.storeId,
    storeName: config.storeName,
    accountId: config.accountId,
    profileId: config.profileId,
    cdpEndpoint: config.cdpEndpoint,
    files,
    totalRows,
    totalUniqueSpu,
    requestCount,
    riskCount,
    adaptiveObservedChunkSize,
    artifactChecksums
  };
}

function writeFinalSummary(summary) {
  const finalChecksums = buildSummary(summary.status).artifactChecksums;
  fs.writeFileSync(
    files.summary,
    JSON.stringify({ ...summary, artifactChecksums: finalChecksums }, null, 2),
    "utf8"
  );
}

main().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  emit("fatal_error", { error: errorMessage, summaryFile: files.summary });
  saveCheckpoint({ failed: true, error: errorMessage });
  const summary = buildSummary("failed");
  summary.error = errorMessage;
  writeFinalSummary(summary);
  process.exitCode = 1;
});
