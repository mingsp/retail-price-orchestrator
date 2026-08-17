import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CdpCommandRecord, CdpEndpointSnapshot } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";

const launched = new Map<number, ReturnType<typeof spawn>>();

export async function executeCdpCommand(config: WorkerConfig, command: CdpCommandRecord): Promise<CdpEndpointSnapshot | undefined> {
  if (command.action === "launch_profile") {
    const profilePath = resolveProfilePath(config, command);
    await fs.mkdir(profilePath, { recursive: true });
    const executable = command.chromeExecutable || config.chromeExecutable;
    const args = buildChromeLaunchArgs(command, profilePath);
    await stopExistingChromeForPort(command.port);
    const child = await spawnDetached(executable, args);
    launched.set(command.port, child);
    await waitForCdp(command.port, 20_000);
    await openIdentityPage(command, profilePath);
    if (command.launchUrl) {
      await openPage(command.port, command.launchUrl).catch(() => undefined);
    }
    return resolveEndpointFromCommand(command);
  }

  if (command.action === "stop_profile") {
    const child = launched.get(command.port);
    launched.delete(command.port);
    await stopProfileChrome(command.port, child?.pid);
    return { ...resolveEndpointFromCommand(command), status: "idle" };
  }

  if (command.action === "open_identity_page") {
    const profilePath = resolveProfilePath(config, command);
    await fs.mkdir(profilePath, { recursive: true });
    await openIdentityPage(command, profilePath);
    return resolveEndpointFromCommand(command);
  }

  if (command.action === "mark_profile_risk") {
    return { ...resolveEndpointFromCommand(command), status: "profile_risk" };
  }

  if (command.action === "retire_profile") {
    return { ...resolveEndpointFromCommand(command), status: "retired" };
  }
}

interface StopProfileChromeDependencies {
  kill?: (pid: number) => void;
  stopByPort?: (port: number) => Promise<void>;
}

export async function stopProfileChrome(
  port: number,
  rememberedPid?: number,
  dependencies: StopProfileChromeDependencies = {}
): Promise<void> {
  const kill = dependencies.kill ?? ((pid: number) => {
    process.kill(pid);
  });
  if (rememberedPid) {
    try {
      kill(rememberedPid);
    } catch {
      // A detached Chrome launcher may exit before the browser process tree.
    }
  }
  await (dependencies.stopByPort ?? stopExistingChromeForPort)(port);
}

async function stopExistingChromeForPort(port: number): Promise<void> {
  const remembered = launched.get(port);
  if (remembered?.pid) {
    try {
      process.kill(remembered.pid);
    } catch {
      // Process may have already exited.
    }
    launched.delete(port);
  }

  if (process.platform === "win32") {
    await runDetachedCommand("powershell", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    ]).catch(() => undefined);
    return;
  }

  await runDetachedCommand("pkill", ["-f", `--remote-debugging-port=${port}`]).catch(() => undefined);
}

function spawnDetached(executable: string, args: string[]): Promise<ReturnType<typeof spawn>> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve(child);
    }, 500);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function runDetachedCommand(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      detached: false,
      stdio: "ignore",
      windowsHide: true
    });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

export function buildChromeLaunchArgs(command: CdpCommandRecord, profilePath: string): string[] {
  const args = [
    `--remote-debugging-port=${command.port}`,
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking"
  ];
  if (command.proxyMode === "direct") {
    args.push("--no-proxy-server");
  }
  return args;
}

export function resolveEndpointFromCommand(command: CdpCommandRecord): CdpEndpointSnapshot {
  return compactEndpoint({
    slotId: command.slotId,
    endpointId: command.endpointId || `${command.workerId}:${command.port}`,
    workerId: command.workerId,
    host: "127.0.0.1",
    port: command.port,
    endpointUrl: `http://127.0.0.1:${command.port}`,
    status: "ready",
    profileId: command.profileId,
    accountId: command.accountId,
    accountDisplayName: command.accountDisplayName,
    maskedLogin: command.maskedLogin,
    operatorOwner: command.operatorOwner,
    targetStoreId: command.targetStoreId,
    targetStoreName: command.targetStoreName
  });
}

function compactEndpoint(endpoint: CdpEndpointSnapshot): CdpEndpointSnapshot {
  return Object.fromEntries(Object.entries(endpoint).filter(([, value]) => value !== undefined)) as CdpEndpointSnapshot;
}

export function resolveProfilePath(config: WorkerConfig, command: CdpCommandRecord): string {
  const profilePath = command.profilePath || command.profileId;
  if (path.isAbsolute(profilePath)) return profilePath;
  return path.resolve(process.cwd(), config.chromeProfileRoot, profilePath);
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await requestText(new URL("/json/version", `http://127.0.0.1:${port}`), "GET");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`CDP port ${port} did not become ready within ${timeoutMs}ms`);
}

async function openIdentityPage(command: CdpCommandRecord, profilePath?: string): Promise<void> {
  await closeExistingIdentityPages(command.port);
  if (!profilePath) {
    await openPage(command.port, buildIdentityDataUrl(command));
    return;
  }
  const identityFile = path.join(profilePath, "retail-radar-identity.html");
  await fs.writeFile(identityFile, buildIdentityHtml(command), "utf8");
  await openPage(command.port, pathToFileURL(identityFile).href);
}

async function openPage(port: number, targetUrl: string): Promise<void> {
  const url = new URL(`/json/new?${encodeURIComponent(targetUrl)}`, `http://127.0.0.1:${port}`);
  await requestText(url, "PUT").catch(async (error) => {
    if (!/method|verb|404|405/i.test(error.message)) throw error;
    await requestText(url, "GET");
  });
}

export function buildIdentityDataUrl(command: CdpCommandRecord): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildIdentityHtml(command))}`;
}

export function buildIdentityHtml(command: CdpCommandRecord): string {
  const endpoint = `http://127.0.0.1:${command.port}`;
  const rows = [
    { label: "设备", id: "device", value: command.workerId, readonly: true },
    { label: "Worker", id: "worker", value: command.workerId, readonly: true },
    { label: "CDP Endpoint", id: "endpoint", value: endpoint, readonly: true },
    { label: "CDP 端口", id: "port", value: String(command.port), readonly: true, className: "endpoint strong" },
    { label: "账号槽位", id: "account", value: command.accountDisplayName || command.accountId || "待填写", className: "strong" },
    { label: "登录手机号（仅本机）", id: "phone", value: command.maskedLogin || "待填写", className: "strong phone" },
    { label: "账号所属人", id: "owner", value: command.operatorOwner || "待填写", className: "strong" },
    { label: "目标门店", id: "store", value: command.targetStoreName || command.targetStoreId || "待填写", className: "strong" },
    { label: "Profile", id: "profile", value: command.profileId, readonly: true },
    { label: "用途", id: "role", value: "多账号低频采集", readonly: true }
  ];
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Retail-Radar CDP Identity - ${escapeHtml(command.accountDisplayName || command.profileId)} - ${escapeHtml(endpoint)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; background: #eef4ff; color: #101828; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(135deg, #f8fbff 0%, #e8efff 46%, #f6f8fb 100%); }
    main { width: min(760px, calc(100vw - 40px)); border: 1px solid rgba(30, 64, 175, 0.16); border-radius: 18px; background: rgba(255,255,255,.9); box-shadow: 0 24px 80px rgba(30,41,59,.18); overflow: hidden; }
    header { padding: 26px 30px 22px; background: linear-gradient(135deg, #0f3fba, #1d4ed8 58%, #0f766e); color: #fff; }
    .eyebrow { margin: 0 0 8px; font-size: 13px; opacity: .82; }
    h1 { margin: 0; font-size: clamp(28px, 5vw, 42px); line-height: 1.08; letter-spacing: 0; }
    .sub { margin: 12px 0 0; font-size: 16px; opacity: .9; }
    section { padding: 24px 30px 30px; }
    .grid { display: grid; grid-template-columns: 148px 1fr; gap: 12px 18px; align-items: center; }
    label { color: #475467; font-size: 14px; }
    input { width: 100%; border: 1px solid #d0d5dd; border-radius: 10px; background: #fff; padding: 10px 12px; color: #101828; font-size: 16px; font-weight: 650; outline: none; }
    input:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.14); }
    input[readonly] { background: #f8fafc; color: #475467; }
    .endpoint { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #0f3fba; }
    .strong { font-size: 18px; font-weight: 850; }
    .phone { color: #b42318; }
    .actions { display: flex; align-items: center; gap: 12px; margin-top: 22px; }
    button { border: 0; border-radius: 9px; padding: 10px 18px; background: #1d4ed8; color: #fff; font-size: 15px; font-weight: 750; cursor: pointer; }
    button:focus { outline: 3px solid rgba(37,99,235,.22); outline-offset: 2px; }
    #save-status { color: #027a48; font-size: 14px; font-weight: 700; }
    .notice { margin-top: 18px; padding: 14px 16px; border: 1px solid #d0d5dd; border-radius: 12px; background: #f9fafb; color: #344054; font-size: 14px; line-height: 1.55; }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Retail-Radar CDP Identity</p>
      <h1>${escapeHtml(command.accountDisplayName || command.profileId)}</h1>
      <p class="sub">${escapeHtml(endpoint)} / ${escapeHtml(command.targetStoreName || command.targetStoreId || "目标门店待填写")}</p>
    </header>
    <section>
      <div class="grid">
        ${rows.map((row) => `<label for="${escapeHtml(row.id)}">${escapeHtml(row.label)}</label><input id="${escapeHtml(row.id)}" class="${escapeHtml(row.className || "")}" value="${escapeHtml(row.value)}"${row.readonly ? " readonly" : ""}>`).join("")}
      </div>
      <div class="actions"><button id="save" type="button">保存标识</button><span id="save-status">尚未人工确认</span></div>
      <div class="notice">完整手机号只保存在当前本机 Profile 的浏览器存储中；Worker 心跳只向 Master 回传脱敏手机号。更换账号后必须同步修改手机号、所属人和目标门店并点击“保存标识”，实际门店页面另开标签页。</div>
    </section>
  </main>
  <script>
    (() => {
      const storageKey = ${JSON.stringify(`retail-radar-identity:${command.profileId}`)};
      const editable = ["account", "phone", "owner", "store"];
      const status = document.getElementById("save-status");
      const read = () => Object.fromEntries(editable.map((id) => [id, document.getElementById(id).value.trim()]));
      const renderSavedAt = (savedAt) => {
        status.textContent = savedAt ? "已本地保存：" + new Date(savedAt).toLocaleString() : "尚未人工确认";
      };
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (stored && stored.values) {
          for (const id of editable) {
            if (stored.values[id]) document.getElementById(id).value = stored.values[id];
          }
          renderSavedAt(stored.savedAt);
        }
      } catch {
        status.textContent = "本地记录读取失败，请重新填写";
      }
      document.getElementById("save").addEventListener("click", () => {
        const payload = { values: read(), savedAt: new Date().toISOString() };
        try {
          localStorage.setItem(storageKey, JSON.stringify(payload));
          renderSavedAt(payload.savedAt);
        } catch {
          status.textContent = "本地保存失败，请保留本页并通知维护人员";
        }
      });
    })();
  </script>
</body>
</html>`;
  return html;
}

async function closeExistingIdentityPages(port: number): Promise<void> {
  const pages = await requestJson<Array<{ id?: string; url?: string; title?: string }>>(
    new URL("/json/list", `http://127.0.0.1:${port}`),
    "GET"
  ).catch(() => []);
  for (const page of pages) {
    const marker = `${page.url || ""} ${page.title || ""}`;
    if (!marker.includes("Retail-Radar CDP Identity")) continue;
    if (!page.id) continue;
    await requestText(new URL(`/json/close/${page.id}`, `http://127.0.0.1:${port}`), "GET").catch(() => undefined);
  }
}

function requestText(url: URL, method: "GET" | "PUT"): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
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

function requestJson<T>(url: URL, method: "GET" | "PUT"): Promise<T> {
  return requestText(url, method).then((body) => JSON.parse(body) as T);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
