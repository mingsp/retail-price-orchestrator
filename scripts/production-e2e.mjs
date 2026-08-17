import { createHash, randomUUID } from "node:crypto";
import WebSocket from "../apps/master/node_modules/ws/wrapper.mjs";

if (process.env.E2E_ALLOW_MUTATIONS !== "true") {
  throw new Error("Refusing production E2E mutations without E2E_ALLOW_MUTATIONS=true");
}
if (process.env.ALLOW_SELF_SIGNED_TLS === "true") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const baseUrl = process.env.MASTER_BASE_URL || "https://localhost:2808";
const operatorToken = required("OPERATOR_TOKEN");
const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const storeId = `e2e-store-${suffix}`;
const workerLabel = `e2e-worker-${suffix}`;
const accountId = `e2e-account-${suffix}`;
const profileId = `e2e-profile-${suffix}`;
const cdpPort = 39000 + Math.floor(Math.random() * 500);
const poiIdStr = `e2e-poi-${suffix}`;
const evidence = [];

await operatorRequest("/api/stores", {
  method: "POST",
  body: { storeId, name: "E2E 验收门店", url: `https://example.invalid/store/${storeId}`, poiIdStr }
});
evidence.push("门店登记");

const tokenResult = await operatorRequest("/api/worker-enrollment-tokens", {
  method: "POST",
  body: { label: workerLabel, expiresInMinutes: 10, maxUses: 1 }
});
const enrolled = await publicRequest("/api/workers/enroll", {
  method: "POST",
  body: {
    enrollmentToken: tokenResult.enrollment.enrollmentToken,
    machineLabel: workerLabel,
    hostname: workerLabel,
    os: "E2E",
    agentVersion: "0.1.0",
    networkMode: "direct",
    capabilities: ["chrome_cdp", "local_artifacts", "manual_verification", "s3_upload"],
    remoteDesktop: { provider: "none", status: "unavailable" }
  }
});
const { workerId, workerToken } = enrolled.enrollment;
evidence.push("一次性接入与独立 Worker 凭据");

const endpointId = `${workerId}:${cdpPort}`;
const slotResult = await operatorRequest("/api/browser-slots", {
  method: "POST",
  body: { workerId, label: "E2E 席位", port: cdpPort }
});
evidence.push("稳定 Browser Slot 创建");

const socket = await connectWorker(workerId, workerToken, {
  type: "worker.register",
  sentAt: new Date().toISOString(),
  worker: {
    workerId,
    machineLabel: workerLabel,
    hostname: workerLabel,
    os: "E2E",
    agentVersion: "0.1.0",
    status: "online",
    networkMode: "direct",
    codexOperator: false,
    capabilities: ["chrome_cdp", "local_artifacts", "manual_verification", "s3_upload"],
    bootId: randomUUID(),
    startedAt: new Date().toISOString(),
    currentIp: "192.0.2.254",
    diskFreeBytes: 10_000_000_000,
    clockOffsetMs: 0,
    remoteDesktop: { provider: "none", status: "unavailable" }
  },
  accounts: [{
    accountId,
    displayName: "E2E 验收账号",
    maskedLogin: "188****0000",
    status: "safe",
    riskLevel: "normal",
    profileId,
    profileStatus: "safe",
    profilePath: "/isolated/e2e-profile",
    cdpPort,
    cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
    currentStoreId: storeId,
    currentStoreName: "E2E 验收门店",
    lastVerifiedAt: new Date().toISOString()
  }],
  cdpEndpoints: [{
    endpointId,
    slotId: slotResult.slot.slotId,
    workerId,
    host: "127.0.0.1",
    port: cdpPort,
    endpointUrl: `http://127.0.0.1:${cdpPort}`,
    status: "ready",
    profileId,
    accountId,
    targetStoreId: storeId,
    targetStoreName: "E2E 验收门店"
  }]
});
evidence.push("WSS 注册与心跳快照");

const workerSelf = await workerRequest(workerToken, "/api/worker/self", { method: "GET" });
if (workerSelf.worker?.worker?.workerId !== workerId) throw new Error("worker self identity mismatch");
const anonymousWorkerSelf = await rawRequest("/api/worker/self", { method: "GET" });
if (anonymousWorkerSelf.status !== 401) throw new Error(`anonymous worker self read was not rejected: HTTP ${anonymousWorkerSelf.status}`);
evidence.push("Worker 独立凭据自助健康检查");

await operatorRequest(`/api/browser-slots/${slotResult.slot.slotId}/bind`, {
  method: "POST",
  body: { accountId, profileId, targetStoreId: storeId }
});
evidence.push("账号/Profile/CDP/门店稳定绑定");

const runResult = await operatorRequest("/api/runs", { method: "POST", body: { storeId, runLabel: `E2E-${suffix}` } });
const taskResult = await operatorRequest(`/api/runs/${runResult.run.runId}/tasks`, {
  method: "POST",
  body: { tasks: [{ categoryName: "E2E 类目", categoryOrder: 1, expectedItems: 1 }] }
});
const taskId = taskResult.tasks[0].taskId;
await operatorRequest(`/api/tasks/${taskId}`, {
  method: "PATCH",
  body: { assignedWorkerId: workerId, assignedAccountId: accountId, assignedProfileId: profileId, assignedCdpEndpointId: endpointId }
});

let claimed = await workerRequest(workerToken, "/api/tasks/claim", {
  method: "POST",
  body: { workerId, accountId, profileId, cdpEndpointId: endpointId, observedPoiIdStr: poiIdStr, observedStoreName: "E2E 验收门店", observedPageState: "ready" }
});
if (!claimed.task) throw new Error(`E2E task was not claimed: ${claimed.reason}`);
evidence.push("固定类目任务领取");

const stale = await rawRequest(`/api/worker/tasks/${taskId}/lease/renew`, {
  method: "POST",
  token: workerToken,
  body: { expectedLeaseOwner: workerId, expectedLeaseGeneration: claimed.task.leaseGeneration + 1, seconds: 60 }
});
if (stale.status !== 409) throw new Error(`stale lease was not rejected: HTTP ${stale.status}`);
await workerRequest(workerToken, `/api/worker/tasks/${taskId}/lease/renew`, {
  method: "POST",
  body: { expectedLeaseOwner: workerId, expectedLeaseGeneration: claimed.task.leaseGeneration, seconds: 60 }
});
evidence.push("租约 fencing 与正常续租");

await operatorRequest(`/api/tasks/${taskId}/actions`, { method: "POST", body: { action: "sleep_2h" } });
const fencedAfterSleep = await rawRequest(`/api/worker/tasks/${taskId}/lease/renew`, {
  method: "POST",
  token: workerToken,
  body: { expectedLeaseOwner: workerId, expectedLeaseGeneration: claimed.task.leaseGeneration, seconds: 60 }
});
if (fencedAfterSleep.status !== 409) throw new Error(`sleep did not revoke the active lease: HTTP ${fencedAfterSleep.status}`);
await operatorRequest(`/api/tasks/${taskId}/actions`, { method: "POST", body: { action: "resume" } });
const priorGeneration = claimed.task.leaseGeneration;
claimed = await workerRequest(workerToken, "/api/tasks/claim", {
  method: "POST",
  body: { workerId, accountId, profileId, cdpEndpointId: endpointId, observedPoiIdStr: poiIdStr, observedStoreName: "E2E 验收门店", observedPageState: "ready" }
});
if (!claimed.task || claimed.task.leaseGeneration <= priorGeneration) throw new Error("resumed task did not receive a fresh lease generation");
evidence.push("人工休眠原子撤销租约并从断点重新领取");

const capturedAt = new Date().toISOString();
const rawObject = {
  ts: capturedAt,
  runId: runResult.run.runId,
  taskId,
  worker: { workerId },
  account: { accountId, profileId, cdpPort },
  store: { storeId, storeName: "E2E 验收门店" },
  category: { name: "E2E 类目", displayName: "E2E 类目" },
  productRaw: {
    id: "e2e-spu-1",
    name: "E2E 原始商品名称",
    unify_price: { price: 9.9, price_str: "9.90" },
    skus: [{ id: "e2e-sku-1", spec: "标准规格", price: 9.9, origin_price: 12.9, stock: 8, unify_price: { price: 9.9, price_str: "9.90" } }]
  }
};
const rawBuffer = Buffer.from(`${JSON.stringify(rawObject)}\n`, "utf8");
const rawChecksum = createHash("sha256").update(rawBuffer).digest("hex");
const objectKey = `${storeId}/${runResult.run.runId}/${taskId}/e2e.products.raw.jsonl`;
const outOfScopePresign = await rawRequest("/api/artifacts/presign", {
  method: "POST",
  token: workerToken,
  body: {
    bucket: "raw-artifacts",
    objectKey: `other-store/other-run/${taskId}/escape.raw.jsonl`,
    taskId,
    runId: runResult.run.runId,
    storeId,
    workerId,
    accountId,
    profileId,
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration
  }
});
if (outOfScopePresign.status !== 409) throw new Error(`out-of-scope artifact key was not rejected: HTTP ${outOfScopePresign.status}`);
const mismatchedPresign = await rawRequest("/api/artifacts/presign", {
  method: "POST",
  token: workerToken,
  body: {
    bucket: "raw-artifacts",
    objectKey,
    taskId,
    runId: runResult.run.runId,
    storeId,
    workerId,
    accountId: "wrong-account",
    profileId,
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration
  }
});
if (mismatchedPresign.status !== 409) throw new Error(`mismatched presign identity was not rejected: HTTP ${mismatchedPresign.status}`);
const presigned = await workerRequest(workerToken, "/api/artifacts/presign", {
  method: "POST",
  body: {
    bucket: "raw-artifacts",
    objectKey,
    taskId,
    runId: runResult.run.runId,
    storeId,
    workerId,
    accountId,
    profileId,
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration
  }
});
const uploaded = await fetch(presigned.url, { method: "PUT", body: rawBuffer });
if (!uploaded.ok) throw new Error(`raw artifact upload failed: HTTP ${uploaded.status} ${await uploaded.text()}`);
const mismatchedRegistration = await rawRequest("/api/artifacts", {
  method: "POST",
  token: workerToken,
  body: {
    taskId,
    runId: runResult.run.runId,
    storeId,
    workerId,
    accountId: "wrong-account",
    profileId,
    kind: "raw_jsonl",
    bucket: "raw-artifacts",
    objectKey,
    sizeBytes: rawBuffer.length,
    checksumSha256: rawChecksum,
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration
  }
});
if (mismatchedRegistration.status !== 409) throw new Error(`mismatched artifact identity was not rejected: HTTP ${mismatchedRegistration.status}`);
const registered = await workerRequest(workerToken, "/api/artifacts", {
  method: "POST",
  body: {
    taskId,
    runId: runResult.run.runId,
    storeId,
    workerId,
    accountId,
    profileId,
    kind: "raw_jsonl",
    bucket: "raw-artifacts",
    objectKey,
    contentType: "application/jsonl",
    sizeBytes: rawBuffer.length,
    checksumSha256: rawChecksum,
    metadata: { adapter: "production-e2e", artifactPart: "raw" },
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration
  }
});
evidence.push("Artifact 路径/身份越权拒绝、同源预签名上传与原始 JSONL 归档");

await workerRequest(workerToken, "/api/product-snapshots/batch", {
  method: "POST",
  body: {
    artifactId: registered.artifact.artifactId,
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration,
    products: [{
      runId: runResult.run.runId,
      taskId,
      storeId,
      storeName: "E2E 验收门店",
      workerId,
      accountId,
      profileId,
      cdpEndpointId: endpointId,
      cdpPort,
      source: "production-e2e",
      sourceTs: capturedAt,
      categoryName: "E2E 类目",
      spuId: "e2e-spu-1",
      productName: "E2E 原始商品名称",
      frontDisplayPriceText: "9.90",
      frontDisplayPriceValue: 9.9,
      priceSourcePath: "productRaw.unify_price.price_str",
      priceSemantics: "front_display_only",
      raw: rawObject.productRaw
    }],
    skus: [{
      runId: runResult.run.runId,
      taskId,
      storeId,
      workerId,
      accountId,
      profileId,
      cdpEndpointId: endpointId,
      sourceTs: capturedAt,
      categoryName: "E2E 类目",
      spuId: "e2e-spu-1",
      skuId: "e2e-sku-1",
      productName: "E2E 原始商品名称",
      spec: "标准规格",
      price: 9.9,
      originPrice: 12.9,
      stock: 8,
      frontDisplayPriceText: "9.90",
      frontDisplayPriceValue: 9.9,
      priceSourcePath: "sku.unify_price.price_str",
      priceSemantics: "front_display_only",
      raw: rawObject.productRaw.skus[0]
    }]
  }
});
await workerRequest(workerToken, "/api/quality-checks", {
  method: "POST",
  body: {
    runId: runResult.run.runId,
    taskId,
    storeId,
    workerId,
    accountId,
    profileId,
    artifactId: registered.artifact.artifactId,
    rawRows: 1,
    uniqueSpuCount: 1,
    skuRows: 1,
    frontDisplayPricePresent: 1,
    skuFrontDisplayPricePresent: 1,
    completenessStatus: "pass",
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration
  }
});
await workerRequest(workerToken, `/api/worker/tasks/${taskId}`, {
  method: "PATCH",
  body: {
    status: "completed_valid",
    collectedItems: 1,
    rawArtifactId: registered.artifact.artifactId,
    lastProgressAt: capturedAt,
    cursor: { completedAt: capturedAt, qualityStatus: "pass" },
    expectedLeaseOwner: workerId,
    expectedLeaseGeneration: claimed.task.leaseGeneration
  }
});
evidence.push("商品/SKU 结构化入库、质量校验与有效类目完成");

const frozen = await operatorRequest(`/api/deliveries/${runResult.run.runId}/freeze`, {
  method: "POST",
  body: { minUserFinalPriceCoverage: 0 }
});
if (frozen.delivery?.status !== "frozen") throw new Error("delivery was not frozen");
const tamperedUpload = await fetch(presigned.url, { method: "PUT", body: Buffer.from("tampered-late-upload\n", "utf8") });
if (!tamperedUpload.ok) throw new Error(`late version upload failed unexpectedly: HTTP ${tamperedUpload.status}`);
const refrozen = await operatorRequest(`/api/deliveries/${runResult.run.runId}/freeze`, {
  method: "POST",
  body: { minUserFinalPriceCoverage: 0 }
});
if (refrozen.delivery?.status !== "frozen") throw new Error("version-pinned delivery could not be reverified after a newer object version");
const exported = await operatorRequest(`/api/deliveries/${runResult.run.runId}/export`, { method: "POST" });
const workbook = await fetch(exported.url);
if (!workbook.ok || Number(workbook.headers.get("content-length") || 0) <= 0) {
  throw new Error(`business workbook download failed: HTTP ${workbook.status}`);
}
evidence.push("逐类目原始文件 versionId/SHA-256 冻结、晚到覆盖隔离与业务 Excel 下载");

socket.close();
console.log(JSON.stringify({ status: "pass", baseUrl, workerId, storeId, taskId, evidence }, null, 2));

async function connectWorker(workerIdValue, token, registerMessage) {
  const url = new URL(`/ws/worker?workerId=${encodeURIComponent(workerIdValue)}`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    const timer = setTimeout(() => { socket.close(); reject(new Error("Worker WSS timeout")); }, 15_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify(registerMessage)), { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "master.error") {
        clearTimeout(timer);
        socket.close();
        reject(new Error(`Worker WSS registration rejected: ${message.message}`));
        return;
      }
      if (message.type !== "master.register_ack") return;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Worker WSS failed")); }, { once: true });
  });
}

function operatorRequest(path, options) { return jsonRequest(path, { ...options, operatorToken }); }
function workerRequest(token, path, options) { return jsonRequest(path, { ...options, token }); }
function publicRequest(path, options) { return jsonRequest(path, options); }

async function jsonRequest(path, options = {}) {
  const response = await rawRequest(path, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed: ${response.status} ${text}`);
  return body;
}

function rawRequest(path, options = {}) {
  return fetch(new URL(path, baseUrl), {
    method: options.method || "GET",
    headers: {
      ...(options.operatorToken ? { "X-Retail-Operator-Token": options.operatorToken } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
