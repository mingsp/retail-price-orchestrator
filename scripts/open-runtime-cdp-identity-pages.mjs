import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const configPath = path.resolve(process.argv[2] || "");
if (!process.argv[2]) {
  throw new Error("Usage: node open-runtime-cdp-identity-pages.mjs <account-map.json>");
}

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const results = [];

for (const slot of config.slots || []) {
  const endpoint = `http://127.0.0.1:${slot.cdpPort}`;
  try {
    const version = await requestJson(new URL("/json/version", endpoint), "GET");
    const pages = await requestJson(new URL("/json/list", endpoint), "GET");
    await closeExistingIdentityPages(endpoint, pages);
    const identityUrl = buildIdentityDataUrl(config, slot, version);
    const page = await openPage(endpoint, identityUrl);
    results.push({
      slot: slot.slot,
      port: slot.cdpPort,
      owner: slot.owner,
      opened: true,
      pageId: page.id || null,
    });
  } catch (error) {
    results.push({
      slot: slot.slot,
      port: slot.cdpPort,
      owner: slot.owner,
      opened: false,
      error: error.message,
    });
  }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);

async function closeExistingIdentityPages(endpoint, pages) {
  for (const page of Array.isArray(pages) ? pages : []) {
    if (
      page.id
      && page.url?.startsWith("data:text/html")
      && page.url.includes("Retail-Radar%20CDP%20Identity")
    ) {
      await requestText(new URL(`/json/close/${page.id}`, endpoint), "GET").catch(() => undefined);
    }
  }
}

async function openPage(endpoint, targetUrl) {
  const url = new URL(`/json/new?${encodeURIComponent(targetUrl)}`, endpoint);
  try {
    return await requestJson(url, "PUT");
  } catch (error) {
    if (!/404|405|method|verb/i.test(error.message)) throw error;
    return requestJson(url, "GET");
  }
}

function buildIdentityDataUrl(config, slot, version) {
  const storeName = config.targetStoreName || "待确认";
  const rows = [
    ["CDP 端口", slot.cdpPort, "strong"],
    ["登录账号", `${slot.owner || "待确认"} / ${slot.phone || "待填写"}`, "account"],
    ["当前状态", formatStatus(slot.status), statusClass(slot.status)],
    ["账号槽位", slot.slot || "", ""],
    ["目标门店", `${storeName} / ${config.targetStoreId || ""}`, "store"],
    ["设备", `${config.device || ""} / ${config.worker || ""}`, ""],
    ["Profile", slot.profile || "", ""],
    ["Browser", version?.Browser || "unknown", ""],
  ];
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Retail-Radar CDP Identity / ${slot.cdpPort} / ${escapeHtml(slot.owner || "")}</title>
  <style>
    :root { font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; color: #172033; background: #eef3fa; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    main { width: min(760px, 100%); background: white; border: 1px solid #d6deea; box-shadow: 0 18px 48px rgba(35, 55, 80, .14); }
    header { padding: 24px 30px; background: #174ea6; color: white; }
    header p { margin: 0 0 8px; font-size: 15px; opacity: .86; }
    h1 { margin: 0; font-size: 42px; letter-spacing: 0; }
    section { padding: 26px 30px 30px; }
    dl { display: grid; grid-template-columns: 120px 1fr; gap: 15px 20px; margin: 0; align-items: start; }
    dt { color: #667085; font-size: 15px; padding-top: 4px; }
    dd { margin: 0; font-size: 17px; font-weight: 650; line-height: 1.45; word-break: break-all; }
    .strong { color: #174ea6; font: 900 30px ui-monospace, Consolas, monospace; }
    .account { color: #b42318; font-size: 25px; font-weight: 900; }
    .store { color: #067647; font-size: 20px; font-weight: 800; }
    .notice { margin-top: 24px; padding: 13px 15px; background: #f8fafc; border-left: 4px solid #174ea6; color: #475467; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <header><p>商圈比价采集账号标识</p><h1>${escapeHtml(slot.slot)} · CDP ${slot.cdpPort}</h1></header>
    <section>
      <dl>${rows.map(([label, value, className]) => `<dt>${escapeHtml(label)}</dt><dd class="${className}">${escapeHtml(value)}</dd>`).join("")}</dl>
      <div class="notice">此页用于区分账号、Profile 和目标门店，请勿关闭。实际采集在另一个门店标签页进行。</div>
    </section>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function requestJson(url, method) {
  return requestText(url, method).then((body) => JSON.parse(body));
}

function requestText(url, method) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode >= 400) {
          reject(new Error(`${response.statusCode} ${response.statusMessage}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatStatus(status) {
  const labels = {
    risk_quarantined_403: "403 风险隔离 · 禁止继续采集",
    diagnosis_hold_403: "403 待诊断 · 暂停请求",
    pending_login_verification: "待登录核验",
    healthy: "可用",
  };
  return labels[status] || status || "待确认";
}

function statusClass(status) {
  return /^(risk_|diagnosis_hold_)/.test(String(status || "")) ? "account" : "";
}
