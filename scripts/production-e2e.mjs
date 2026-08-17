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
let accountId;
let profileId = `e2e-profile-a-${suffix}`;
let cdpPort = 39000 + Math.floor(Math.random() * 250);
const poiIdStr = `e2e-poi-${suffix}`;
const evidence = [];

await operatorRequest("/api/stores", {
  method: "POST",
  body: { storeId, name: "E2E 验收门店", url: `https://example.invalid/store/${storeId}`, poiIdStr }
});
evidence.push("门店登记");

const poolResult = await operatorRequest("/api/account-pool", {
  method: "POST",
  body: { displayName: "E2E 验收账号", maskedLogin: "188****0000", operatorOwner: "E2E 验收" }
});
accountId = poolResult.account.accountId;
evidence.push("生产账号池登记");

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
let { workerId, workerToken } = enrolled.enrollment;
evidence.push("一次性接入与独立 Worker 凭据");

let endpointId = `${workerId}:${cdpPort}`;
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

const secondPoolResult = await operatorRequest("/api/account-pool", {
  method: "POST",
  body: { displayName: "E2E 迁移账号", maskedLogin: "188****0001", operatorOwner: "E2E 验收" }
});
const secondAccountId = secondPoolResult.account.accountId;
const secondWorkerLabel = `${workerLabel}-migration`;
const secondProfileId = `e2e-profile-b-${suffix}`;
const secondCdpPort = cdpPort + 500;
const secondTokenResult = await operatorRequest("/api/worker-enrollment-tokens", {
  method: "POST",
  body: { label: secondWorkerLabel, expiresInMinutes: 10, maxUses: 1 }
});
const secondEnrolled = await publicRequest("/api/workers/enroll", {
  method: "POST",
  body: {
    enrollmentToken: secondTokenResult.enrollment.enrollmentToken,
    machineLabel: secondWorkerLabel,
    hostname: secondWorkerLabel,
    os: "E2E",
    agentVersion: "0.1.0",
    networkMode: "direct",
    capabilities: ["chrome_cdp", "local_artifacts", "manual_verification", "s3_upload"],
    remoteDesktop: { provider: "none", status: "unavailable" }
  }
});
const secondWorkerId = secondEnrolled.enrollment.workerId;
const secondWorkerToken = secondEnrolled.enrollment.workerToken;
const secondEndpointId = `${secondWorkerId}:${secondCdpPort}`;
const secondSlotResult = await operatorRequest("/api/browser-slots", {
  method: "POST",
  body: { workerId: secondWorkerId, label: "E2E 迁移席位", port: secondCdpPort }
});
const secondSocket = await connectWorker(secondWorkerId, secondWorkerToken, {
  type: "worker.register",
  sentAt: new Date().toISOString(),
  worker: {
    workerId: secondWorkerId,
    machineLabel: secondWorkerLabel,
    hostname: secondWorkerLabel,
    os: "E2E",
    agentVersion: "0.1.0",
    status: "online",
    networkMode: "direct",
    codexOperator: false,
    capabilities: ["chrome_cdp", "local_artifacts", "manual_verification", "s3_upload"],
    bootId: randomUUID(),
    startedAt: new Date().toISOString(),
    currentIp: "192.0.2.253",
    diskFreeBytes: 10_000_000_000,
    clockOffsetMs: 0,
    remoteDesktop: { provider: "none", status: "unavailable" }
  },
  accounts: [{
    accountId: secondAccountId,
    displayName: "E2E 迁移账号",
    maskedLogin: "188****0001",
    status: "safe",
    riskLevel: "normal",
    profileId: secondProfileId,
    profileStatus: "safe",
    profilePath: "/isolated/e2e-profile-b",
    cdpPort: secondCdpPort,
    cdpEndpoint: `http://127.0.0.1:${secondCdpPort}`,
    currentStoreId: storeId,
    currentStoreName: "E2E 验收门店",
    lastVerifiedAt: new Date().toISOString()
  }],
  cdpEndpoints: [{
    endpointId: secondEndpointId,
    slotId: secondSlotResult.slot.slotId,
    workerId: secondWorkerId,
    host: "127.0.0.1",
    port: secondCdpPort,
    endpointUrl: `http://127.0.0.1:${secondCdpPort}`,
    status: "ready",
    profileId: secondProfileId,
    accountId: secondAccountId,
    targetStoreId: storeId,
    targetStoreName: "E2E 验收门店"
  }]
});
await operatorRequest(`/api/browser-slots/${secondSlotResult.slot.slotId}/bind`, {
  method: "POST",
  body: { accountId: secondAccountId, profileId: secondProfileId, targetStoreId: storeId }
});
evidence.push("第二 Worker 独立账号/Profile/CDP 就绪");

const scopeResult = await operatorRequest("/api/scope-manifests", {
  method: "POST",
  body: {
    storeId,
    includeCoupons: false,
    categories: [{ canonicalCategoryKey: "name:E2E类目", categoryName: "E2E 类目", categoryOrder: 1 }]
  }
});
const runBody = {
  storeId,
  runLabel: `E2E-${suffix}`,
  scheduleWindow: `E2E-${suffix}`,
  scopeVersion: scopeResult.scopeManifest.scopeVersion,
  scopeManifestId: scopeResult.scopeManifest.scopeManifestId
};
const concurrentRuns = await Promise.all(Array.from({ length: 50 }, () => operatorRequest("/api/runs", {
  method: "POST",
  body: runBody
})));
if (new Set(concurrentRuns.map((result) => result.run.runId)).size !== 1) throw new Error("concurrent run creation was not idempotent");
const runResult = concurrentRuns[0];
const concurrentTaskSets = await Promise.all(Array.from({ length: 50 }, () => operatorRequest(`/api/runs/${runResult.run.runId}/tasks`, {
  method: "POST",
  body: { tasks: [{ categoryName: "E2E 类目", canonicalCategoryKey: "name:E2E类目", categoryOrder: 1, expectedItems: 1 }] }
})));
if (new Set(concurrentTaskSets.flatMap((result) => result.tasks.map((task) => task.taskId))).size !== 1) {
  throw new Error("concurrent category task creation was not idempotent");
}
const taskResult = concurrentTaskSets[0];
const taskId = taskResult.tasks[0].taskId;
evidence.push("50 路批次与 50 路规范类目并发创建收敛为唯一记录");
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
await operatorRequest(`/api/tasks/${taskId}`, {
  method: "PATCH",
  body: {
    assignedWorkerId: secondWorkerId,
    assignedAccountId: secondAccountId,
    assignedProfileId: secondProfileId,
    assignedCdpEndpointId: secondEndpointId
  }
});
claimed = await workerRequest(secondWorkerToken, "/api/tasks/claim", {
  method: "POST",
  body: { workerId: secondWorkerId, accountId: secondAccountId, profileId: secondProfileId, cdpEndpointId: secondEndpointId, observedPoiIdStr: poiIdStr, observedStoreName: "E2E 验收门店", observedPageState: "ready" }
});
if (!claimed.task || claimed.task.leaseGeneration <= priorGeneration) throw new Error("resumed task did not receive a fresh lease generation");
const oldWorkerLateWrite = await rawRequest(`/api/worker/tasks/${taskId}/lease/renew`, {
  method: "POST",
  token: workerToken,
  body: { expectedLeaseOwner: workerId, expectedLeaseGeneration: priorGeneration, seconds: 60 }
});
if (oldWorkerLateWrite.status !== 409) throw new Error(`old Worker late write was not fenced: HTTP ${oldWorkerLateWrite.status}`);
workerId = secondWorkerId;
workerToken = secondWorkerToken;
accountId = secondAccountId;
profileId = secondProfileId;
cdpPort = secondCdpPort;
endpointId = secondEndpointId;
evidence.push("人工休眠、跨 Worker 迁移、旧 generation 拒绝并从断点重新领取");

await workerRequest(workerToken, `/api/worker/tasks/${taskId}`, {
  method: "PATCH",
  body: {
    status: "collecting",
    expectedLeaseOwner: workerId,
    expectedLeaseGeneration: claimed.task.leaseGeneration
  }
});

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
await workerRequest(workerToken, `/api/worker/tasks/${taskId}`, {
  method: "PATCH",
  body: {
    status: "captured",
    collectedItems: 1,
    expectedLeaseOwner: workerId,
    expectedLeaseGeneration: claimed.task.leaseGeneration
  }
});
await workerRequest(workerToken, `/api/worker/tasks/${taskId}`, {
  method: "PATCH",
  body: {
    status: "uploading",
    expectedLeaseOwner: workerId,
    expectedLeaseGeneration: claimed.task.leaseGeneration
  }
});
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
await workerRequest(workerToken, `/api/worker/tasks/${taskId}`, {
  method: "PATCH",
  body: {
    status: "structuring",
    rawArtifactId: registered.artifact.artifactId,
    expectedLeaseOwner: workerId,
    expectedLeaseGeneration: claimed.task.leaseGeneration
  }
});

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
await workerRequest(workerToken, `/api/worker/tasks/${taskId}`, {
  method: "PATCH",
  body: {
    status: "validating",
    lastProgressAt: capturedAt,
    expectedLeaseOwner: workerId,
    expectedLeaseGeneration: claimed.task.leaseGeneration
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
    metadata: { categoryComplete: true, source: "production-e2e" },
    leaseOwner: workerId,
    leaseGeneration: claimed.task.leaseGeneration
  }
});
evidence.push("商品/SKU 结构化入库、Master 质量裁决与有效类目完成");

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
secondSocket.close();
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
