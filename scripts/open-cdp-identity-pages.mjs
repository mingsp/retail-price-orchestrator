import http from "node:http";

const masterBaseUrl = process.env.MASTER_BASE_URL || "http://127.0.0.1:17890";
const fallbackEndpoints = [
  {
    endpoint: "http://127.0.0.1:9224",
    worker: "mm-worker",
    device: "mm 本机 Windows",
    slot: "mm-账号01",
    account: "待登录/待识别",
    profile: "mm-account-01-safe-20260706",
    role: "本机采集账号 1"
  },
  {
    endpoint: "http://127.0.0.1:9225",
    worker: "mm-worker",
    device: "mm 本机 Windows",
    slot: "mm-账号02",
    account: "待登录/待识别",
    profile: "mm-account-02-safe-20260706",
    role: "本机采集账号 2"
  },
  {
    endpoint: "http://127.0.0.1:19224",
    worker: "jl-worker",
    device: "远程 Worker 示例",
    slot: "jl-账号01",
    account: "待登录/待识别",
    profile: "jl-account-01-safe-20260706",
    role: "jl 远程采集账号 1"
  },
  {
    endpoint: "http://127.0.0.1:19225",
    worker: "jl-worker",
    device: "远程 Worker 示例",
    slot: "jl-账号02",
    account: "待登录/待识别",
    profile: "jl-account-02-safe-20260706",
    role: "jl 远程采集账号 2"
  }
];

async function main() {
  const endpoints = await loadEndpoints();
  for (const item of endpoints) {
    try {
      const version = await requestJson(new URL("/json/version", item.endpoint), "GET");
      const pages = await requestJson(new URL("/json/list", item.endpoint), "GET");
      await closeExistingIdentityPages(item.endpoint, pages);
      const targetUrl = buildIdentityDataUrl(item, version);
      const page = await openPage(item.endpoint, targetUrl);
      console.log(`[ok] ${item.slot} ${item.endpoint} -> page ${page.id || "created"}`);
    } catch (error) {
      console.error(`[fail] ${item.slot} ${item.endpoint}: ${error.message}`);
    }
  }
}

async function loadEndpoints() {
  try {
    const payload = await requestJson(new URL("/api/workers", masterBaseUrl), "GET");
    const rows = [];
    for (const workerSnapshot of payload.workers || []) {
      for (const account of workerSnapshot.accounts || []) {
        if (!account.cdpEndpoint) {
          continue;
        }
        rows.push({
          endpoint: account.cdpEndpoint,
          worker: workerSnapshot.worker.workerId,
          device: workerSnapshot.worker.machineLabel,
          slot: account.displayName || account.accountId,
          account: account.maskedLogin || "待登录/待识别",
          cdpPort: parseCdpPort(account.cdpEndpoint, account.cdpPort),
          profile: account.profilePath || account.profileId,
          role: `${workerSnapshot.worker.networkMode || "unknown"} / ${account.status || "unknown"}`
        });
      }
    }
    return rows.length > 0 ? rows : fallbackEndpoints;
  } catch {
    return fallbackEndpoints;
  }
}

async function closeExistingIdentityPages(endpoint, pages) {
  if (!Array.isArray(pages)) {
    return;
  }
  const identityPages = pages.filter((page) => page.url?.startsWith("data:text/html") && page.url.includes("Retail-Radar%20CDP%20Identity"));
  for (const page of identityPages) {
    if (page.id) {
      await requestText(new URL(`/json/close/${page.id}`, endpoint), "GET").catch(() => undefined);
    }
  }
}

async function openPage(endpoint, targetUrl) {
  const url = new URL(`/json/new?${encodeURIComponent(targetUrl)}`, endpoint);
  try {
    return await requestJson(url, "PUT");
  } catch (error) {
    if (!/method|verb|404|405/i.test(error.message)) {
      throw error;
    }
    return await requestJson(url, "GET");
  }
}

function buildIdentityDataUrl(item, version) {
  const rows = [
    ["设备", item.device],
    ["Worker", item.worker],
    ["CDP Endpoint", item.endpoint],
    ["CDP 端口", item.cdpPort || parseCdpPort(item.endpoint)],
    ["账号槽位", item.slot],
    ["登录手机号", item.account],
    ["Profile", item.profile],
    ["用途", item.role],
    ["浏览器", version?.Browser || "unknown"],
    ["打开时间", new Date().toLocaleString("zh-CN", { hour12: false })]
  ];
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Retail-Radar CDP Identity - ${escapeHtml(item.slot)} - ${escapeHtml(item.endpoint)}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
      background: #eef4ff;
      color: #101828;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 18% 18%, rgba(37, 99, 235, 0.18), transparent 32%),
        linear-gradient(135deg, #f8fbff 0%, #e8efff 46%, #f6f8fb 100%);
    }
    main {
      width: min(720px, calc(100vw - 40px));
      border: 1px solid rgba(30, 64, 175, 0.16);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 24px 80px rgba(30, 41, 59, 0.18);
      overflow: hidden;
    }
    header {
      padding: 26px 30px 22px;
      background: linear-gradient(135deg, #0f3fba, #1d4ed8 58%, #0f766e);
      color: white;
    }
    .eyebrow {
      margin: 0 0 8px;
      font-size: 13px;
      letter-spacing: 0;
      opacity: 0.82;
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 5vw, 44px);
      line-height: 1.08;
      letter-spacing: 0;
    }
    .sub {
      margin: 12px 0 0;
      font-size: 16px;
      opacity: 0.9;
    }
    section {
      padding: 24px 30px 30px;
    }
    dl {
      margin: 0;
      display: grid;
      grid-template-columns: 148px 1fr;
      gap: 12px 18px;
      align-items: start;
    }
    dt {
      color: #475467;
      font-size: 14px;
      padding-top: 3px;
    }
    dd {
      margin: 0;
      font-size: 16px;
      font-weight: 650;
      line-height: 1.45;
      word-break: break-word;
    }
    .endpoint {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #0f3fba;
    }
    .strong {
      font-size: 18px;
      font-weight: 850;
    }
    .phone {
      color: #b42318;
    }
    .notice {
      margin-top: 24px;
      padding: 14px 16px;
      border: 1px solid #d0d5dd;
      border-radius: 12px;
      background: #f9fafb;
      color: #344054;
      font-size: 14px;
      line-height: 1.55;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Retail-Radar CDP Identity</p>
      <h1>${escapeHtml(item.slot)}</h1>
      <p class="sub">${escapeHtml(item.device)} / ${escapeHtml(item.role)}</p>
    </header>
    <section>
      <dl>
        ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd class="${getRowClass(label)}">${escapeHtml(value)}</dd>`).join("")}
      </dl>
      <div class="notice">这是 CDP 身份标识页，用于区分多设备、多 Profile、多账号。采集时请保留此页，实际门店页面可以另开标签页。</div>
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
    const req = http.request(url, { method }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`${res.statusCode} ${res.statusMessage}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function parseCdpPort(endpoint, fallback = "") {
  try {
    return String(new URL(endpoint).port || fallback || "");
  } catch {
    return String(fallback || "");
  }
}

function getRowClass(label) {
  if (label === "CDP Endpoint" || label === "CDP 端口") {
    return "endpoint strong";
  }
  if (label === "登录手机号") {
    return "strong phone";
  }
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

main();
