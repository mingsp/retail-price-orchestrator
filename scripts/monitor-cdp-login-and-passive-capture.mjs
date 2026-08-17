import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const masterBaseUrl = process.env.MASTER_BASE_URL || "http://127.0.0.1:17890";
const intervalMs = Number(process.env.MONITOR_INTERVAL_MS || 30 * 60 * 1000);
const root = path.resolve(process.cwd(), "..");
const runtimeDir = path.resolve(process.cwd(), ".runtime");
const logFile = path.join(runtimeDir, `cdp-login-monitor-${shanghaiDate()}.jsonl`);
const targetUrlPart = process.env.MT_TARGET_URL_PART || "cactivityapi-sc.waimai.meituan.com";
const passiveScript = path.join(root, "mt-cdp-passive-product-listener.mjs");
const activePassiveListeners = new Map();

const riskPatterns = [
  "验证码",
  "验证中心",
  "身份核实",
  "账号异常",
  "拒绝",
  "403",
  "418",
  "verify.meituan.com",
  "yoda"
];

const loginPatterns = ["登录", "手机号", "验证码登录", "短信验证码"];

fs.mkdirSync(runtimeDir, { recursive: true });

async function main() {
  appendLog({ event: "monitor_started", masterBaseUrl, intervalMs, targetUrlPart });
  while (true) {
    await checkOnce().catch((error) => {
      appendLog({ event: "monitor_error", error: error.message });
      console.error(`[monitor] ${error.stack || error.message}`);
    });
    await sleep(intervalMs);
  }
}

async function checkOnce() {
  const payload = await requestJson(new URL("/api/workers", masterBaseUrl));
  const rows = [];
  for (const workerSnapshot of payload.workers || []) {
    for (const account of workerSnapshot.accounts || []) {
      rows.push({ worker: workerSnapshot.worker, account });
    }
  }

  const summary = [];
  for (const row of rows) {
    const result = await inspectAccount(row.worker, row.account);
    summary.push(result);
    appendLog({ event: "cdp_checked", ...result });
    if (result.storePageFound && !result.riskFound) {
      startPassiveListener(row.worker, row.account, result);
    }
  }

  console.log(`[monitor] ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  for (const item of summary) {
    console.log(
      [
        item.accountId,
        `port=${item.cdpPort}`,
        item.online ? "online" : "offline",
        item.storePageFound ? "store" : "no-store",
        item.loginFound ? "login" : "",
        item.riskFound ? `risk=${item.riskReason}` : "",
        item.passiveListenerStarted ? "passive=running" : ""
      ].filter(Boolean).join(" ")
    );
  }
}

async function inspectAccount(worker, account) {
  const base = account.cdpEndpoint || `http://127.0.0.1:${account.cdpPort}`;
  const result = {
    workerId: worker.workerId,
    machineLabel: worker.machineLabel,
    accountId: account.accountId,
    displayName: account.displayName,
    maskedLogin: account.maskedLogin,
    cdpPort: account.cdpPort,
    cdpEndpoint: base,
    online: false,
    pages: [],
    storePageFound: false,
    loginFound: false,
    riskFound: false,
    riskReason: "",
    passiveListenerStarted: activePassiveListeners.has(account.accountId)
  };

  let pages;
  try {
    pages = await requestJson(new URL("/json/list", base));
    result.online = true;
  } catch (error) {
    result.error = error.message;
    return result;
  }

  for (const page of pages.filter((item) => item.type === "page")) {
    const title = page.title || "";
    const url = page.url || "";
    const text = `${title}\n${url}`;
    const pageSummary = { title, url: url.slice(0, 260) };
    result.pages.push(pageSummary);
    if (url.includes(targetUrlPart) || url.includes("meituan.com")) {
      if (url.includes("/restaurant") || url.includes("sub-trade")) {
        result.storePageFound = true;
      }
      const loginReason = loginPatterns.find((pattern) => text.includes(pattern));
      const riskReason = riskPatterns.find((pattern) => text.includes(pattern));
      if (loginReason) result.loginFound = true;
      if (riskReason) {
        result.riskFound = true;
        result.riskReason = riskReason;
      }
    }
  }

  result.passiveListenerStarted = activePassiveListeners.has(account.accountId);
  return result;
}

function startPassiveListener(worker, account, inspectResult) {
  if (activePassiveListeners.has(account.accountId)) {
    return;
  }
  if (!fs.existsSync(passiveScript)) {
    appendLog({ event: "passive_listener_missing", accountId: account.accountId, passiveScript });
    return;
  }

  const captureDate = shanghaiDate();
  const runId = `passive-${worker.workerId}-${account.accountId}-${captureDate}-${Date.now()}`;
  const stopFile = path.join(runtimeDir, `${runId}.stop`);
  const logPath = path.join(runtimeDir, `${runId}.log`);
  const child = spawn(process.execPath, [passiveScript], {
    cwd: root,
    env: {
      ...process.env,
      MT_RUN_ID: runId,
      MT_CDP_PORT: String(account.cdpPort),
      MT_ACCOUNT_LABEL: account.displayName || account.accountId,
      MT_TARGET_URL_PART: targetUrlPart,
      MT_STOP_FILE: stopFile
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stream = fs.createWriteStream(logPath, { flags: "a" });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  activePassiveListeners.set(account.accountId, { child, runId, logPath, stopFile });
  appendLog({
    event: "passive_listener_started",
    workerId: worker.workerId,
    accountId: account.accountId,
    cdpPort: account.cdpPort,
    runId,
    logPath,
    page: inspectResult.pages.find((page) => page.url.includes(targetUrlPart)) || null
  });

  child.on("exit", (code) => {
    activePassiveListeners.delete(account.accountId);
    appendLog({ event: "passive_listener_exited", accountId: account.accountId, runId, code });
  });
}

function appendLog(row) {
  fs.appendFileSync(logFile, JSON.stringify({ observedAt: new Date().toISOString(), ...row }) + "\n", "utf8");
}

async function requestJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replaceAll("-", "");
}

main();
