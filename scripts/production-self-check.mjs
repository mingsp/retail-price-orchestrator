const masterBaseUrl = process.env.MASTER_BASE_URL || "http://127.0.0.1:17890";
const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL || "http://127.0.0.1:2808";
const requireTls = process.env.REQUIRE_TLS === "true";
const operatorToken = process.env.OPERATOR_TOKEN?.trim();
if (process.env.ALLOW_SELF_SIGNED_TLS === "true") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const checks = [];

checks.push({
  name: "生产传输加密",
  ok: !requireTls || (new URL(masterBaseUrl).protocol === "https:" && new URL(dashboardBaseUrl).protocol === "https:"),
  detail: requireTls ? "要求 HTTPS/WSS" : "开发模式未强制 TLS"
});

await checkJson("Master 存活", "/health", (body) => body.ok === true);
await checkJson("依赖就绪", "/ready", (body) => {
  if (Array.isArray(body.dependencies)) {
    const names = new Set(body.dependencies.filter((item) => item.ok).map((item) => item.name));
    return body.ok === true && names.has("postgres") && names.has("redis") && names.has("object_storage");
  }
  return body.ok === true && body.postgres === "ok" && body.redis === "ok" && body.s3 === "ok";
});
await checkJson("业务概览", "/api/business/v1/overview", noTechnicalFields);
await checkJson("批次完整度", "/api/business/v1/runs", noTechnicalFields);
await checkJson("实时业务动态", "/api/business/v1/activities?limit=5", noTechnicalFields);
await checkJson("异常待办", "/api/business/v1/issues?limit=5", noTechnicalFields);
await checkJson("数据结果", "/api/business/v1/deliveries", noTechnicalFields);
await checkText("指标接口", "/metrics", (text) =>
  text.includes("retail_orchestrator_active_tasks") &&
  text.includes("retail_orchestrator_http_errors_total") &&
  text.includes("retail_orchestrator_worker_websocket_connections")
);
await checkDashboardWebSocket();

try {
  const response = await fetch(dashboardBaseUrl);
  checks.push({ name: "采集工作台", ok: response.ok, detail: `HTTP ${response.status}` });
} catch (error) {
  checks.push({ name: "采集工作台", ok: false, detail: error instanceof Error ? error.message : String(error) });
}

const report = {
  checkedAt: new Date().toISOString(),
  masterBaseUrl,
  dashboardBaseUrl,
  status: checks.every((item) => item.ok) ? "pass" : "fail",
  checks
};
console.log(JSON.stringify(report, null, 2));
if (report.status !== "pass") process.exitCode = 1;

async function checkJson(name, path, validate) {
  try {
    const response = await fetch(new URL(path, masterBaseUrl), requestOptions(path));
    const body = await response.json();
    checks.push({ name, ok: response.ok && validate(body), detail: `HTTP ${response.status}` });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function checkText(name, path, validate) {
  try {
    const response = await fetch(new URL(path, masterBaseUrl), requestOptions(path));
    const body = await response.text();
    checks.push({ name, ok: response.ok && validate(body), detail: `HTTP ${response.status}` });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

function noTechnicalFields(value) {
  const forbidden = new Set(["workerId", "profileId", "cdpPort", "cdpEndpoint", "cdpEndpointId", "objectKey", "rawError", "accountId"]);
  if (!value || typeof value !== "object") return true;
  if (Array.isArray(value)) return value.every(noTechnicalFields);
  return Object.entries(value).every(([key, child]) => !forbidden.has(key) && noTechnicalFields(child));
}

async function checkDashboardWebSocket() {
  const url = new URL("/ws/dashboard", masterBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  await new Promise((resolve) => {
    const protocols = ["retail-dashboard-v1"];
    if (operatorToken) protocols.push(`retail-operator.${Buffer.from(operatorToken, "utf8").toString("base64url")}`);
    const socket = new WebSocket(url, protocols);
    const timer = setTimeout(() => {
      socket.close();
      checks.push({ name: "实时状态通道", ok: false, detail: "连接超时" });
      resolve();
    }, 5_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timer);
      let ok = false;
      try { ok = JSON.parse(String(event.data)).type === "dashboard.snapshot"; } catch {}
      checks.push({ name: "实时状态通道", ok, detail: ok ? `已连接 ${url.protocol}` : "首条消息格式异常" });
      socket.close();
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      checks.push({ name: "实时状态通道", ok: false, detail: `${url.protocol} 连接失败` });
      resolve();
    }, { once: true });
  });
}

function requestOptions(path) {
  return path.startsWith("/api/") && operatorToken
    ? { headers: { "X-Retail-Operator-Token": operatorToken } }
    : undefined;
}
