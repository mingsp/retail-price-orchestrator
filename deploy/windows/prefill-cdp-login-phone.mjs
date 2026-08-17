import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PHONE_PATTERN = /^1\d{10}$/;
let requestId = 0;

export function validatePrivateConfig(raw) {
  if (!raw || typeof raw !== "object") throw new Error("private config must be an object");
  const workerLabel = requiredText(raw.workerLabel, "workerLabel");
  if (!Array.isArray(raw.assignments) || raw.assignments.length === 0) {
    throw new Error("assignments must contain at least one item");
  }

  const ports = new Set();
  const phones = new Set();
  const assignments = raw.assignments.map((item) => {
    if (!item || typeof item !== "object") throw new Error("assignment must be an object");
    const port = Number(item.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid CDP port");
    if (ports.has(port)) throw new Error("duplicate CDP port");
    ports.add(port);

    const phone = requiredText(item.phone, "phone");
    if (!PHONE_PATTERN.test(phone)) throw new Error("phone must be a full mainland mobile number");
    if (phones.has(phone)) throw new Error("duplicate full phone assignment");
    phones.add(phone);

    return {
      port,
      profileId: requiredText(item.profileId, "profileId"),
      account: requiredText(item.account, "account"),
      phone,
      owner: requiredText(item.owner, "owner"),
      store: requiredText(item.store, "store")
    };
  });

  return { workerLabel, assignments };
}

export function selectCdpPages(pages) {
  if (!Array.isArray(pages)) throw new Error("CDP page list is invalid");
  const identity = pages.find((page) => {
    if (page?.type !== "page" || !page.webSocketDebuggerUrl) return false;
    return String(page.title || "").includes("Retail-Radar CDP Identity")
      || String(page.url || "").includes("retail-radar-identity.html");
  });
  const login = pages.find((page) => {
    if (page?.type !== "page" || !page.webSocketDebuggerUrl) return false;
    try {
      const url = new URL(String(page.url || ""));
      return /(^|\.)waimai\.meituan\.com$/i.test(url.hostname) && /^\/login(?:\/|$)/i.test(url.pathname);
    } catch {
      return false;
    }
  });
  if (!identity) throw new Error("local identity page was not found");
  if (!login) throw new Error("Meituan login page was not found");
  return { identity, login };
}

export function buildCdpPageActionUrl(port, action, targetId) {
  if (!Number.isInteger(Number(port))) throw new Error("invalid CDP port");
  if (!/^(?:activate)$/.test(action)) throw new Error("unsupported CDP page action");
  if (typeof targetId !== "string" || !targetId) throw new Error("CDP target id is required");
  return `http://127.0.0.1:${Number(port)}/json/${action}/${encodeURIComponent(targetId)}`;
}

export function buildIdentityExpression(assignment) {
  const payload = JSON.stringify(assignment);
  return `(() => {
    const expected = ${payload};
    const value = (id) => document.getElementById(id)?.value?.trim?.() || "";
    if (value("profile") !== expected.profileId || value("port") !== String(expected.port)) {
      return { ok: false, code: "identity_mismatch" };
    }
    const values = {
      account: expected.account,
      phone: expected.phone,
      owner: expected.owner,
      store: expected.store
    };
    for (const [id, next] of Object.entries(values)) {
      const input = document.getElementById(id);
      if (!input) return { ok: false, code: "identity_field_missing" };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, next); else input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const savedAt = new Date().toISOString();
    localStorage.setItem("retail-radar-identity:" + expected.profileId, JSON.stringify({ values, savedAt }));
    const status = document.getElementById("save-status");
    if (status) status.textContent = "已本地保存：" + new Date(savedAt).toLocaleString();
    const verified = Object.entries(values).every(([id, next]) => value(id) === next);
    return { ok: verified, code: verified ? "identity_filled" : "identity_verify_failed" };
  })()`;
}

export function buildLoginExpression(assignment) {
  const phone = JSON.stringify(assignment.phone);
  return `(() => {
    const phone = ${phone};
    const documents = [document];
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try { if (frame.contentDocument) documents.push(frame.contentDocument); } catch {}
    }
    const visible = (input) => {
      const style = input.ownerDocument.defaultView.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      return !input.disabled && !input.readOnly && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const candidates = documents.flatMap((doc) => Array.from(doc.querySelectorAll("input"))).filter(visible);
    const scored = candidates.map((input) => {
      const hint = [input.type, input.name, input.id, input.placeholder, input.autocomplete, input.inputMode, input.getAttribute("aria-label")]
        .filter(Boolean).join(" ").toLowerCase();
      const isCode = /验证码|校验码|短信码|verify|verification|captcha|code/.test(hint) || (input.maxLength > 0 && input.maxLength <= 6);
      let score = isCode ? -100 : 0;
      if (/手机号|手机号码|phone|mobile|tel/.test(hint)) score += 20;
      if (input.type === "tel") score += 10;
      if (input.autocomplete === "tel") score += 8;
      if (input.inputMode === "numeric" || input.inputMode === "tel") score += 4;
      if (input.maxLength === 11) score += 5;
      return { input, score };
    }).sort((a, b) => b.score - a.score);
    let selected = scored.find((entry) => entry.score > 0)?.input;
    if (!selected) {
      const fallback = scored.filter((entry) => entry.score > -100 && ["", "text", "tel", "number"].includes(entry.input.type));
      if (fallback.length === 1) selected = fallback[0].input;
    }
    if (!selected) return { ok: false, code: "phone_input_not_found" };
    const view = selected.ownerDocument.defaultView;
    const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(selected, phone); else selected.value = phone;
    selected.dispatchEvent(new view.Event("input", { bubbles: true }));
    selected.dispatchEvent(new view.Event("change", { bubbles: true }));
    selected.focus();
    try { selected.setSelectionRange(phone.length, phone.length); } catch {}
    return { ok: selected.value === phone, code: selected.value === phone ? "login_phone_filled" : "login_phone_verify_failed" };
  })()`;
}

async function prefillAssignment(assignment) {
  const baseUrl = `http://127.0.0.1:${assignment.port}`;
  const pages = await requestJson(`${baseUrl}/json/list`);
  const selected = selectCdpPages(pages);
  await activatePage(assignment.port, selected.identity.id);
  const identityResult = await evaluate(normalizeWebSocketUrl(selected.identity.webSocketDebuggerUrl, assignment.port), buildIdentityExpression(assignment));
  if (!identityResult?.ok) throw new Error(identityResult?.code || "identity_prefill_failed");
  await activatePage(assignment.port, selected.login.id);
  const loginWs = normalizeWebSocketUrl(selected.login.webSocketDebuggerUrl, assignment.port);
  const loginResult = await evaluate(loginWs, buildLoginExpression(assignment));
  if (!loginResult?.ok) throw new Error(loginResult?.code || "login_prefill_failed");
  await cdpCommand(loginWs, "Page.bringToFront");
  return { identity: identityResult.code, login: loginResult.code };
}

async function activatePage(port, targetId) {
  if (!targetId) throw new Error("cdp_target_missing");
  const response = await fetch(buildCdpPageActionUrl(port, "activate", targetId), {
    method: "GET",
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) throw new Error("cdp_target_activate_failed");
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const config = validatePrivateConfig(JSON.parse(await readFile(configPath, "utf8")));
  const results = [];

  for (const assignment of config.assignments) {
    try {
      const status = await prefillAssignment(assignment);
      results.push({
        worker: config.workerLabel,
        account: assignment.account,
        port: assignment.port,
        profileId: assignment.profileId,
        ok: true,
        identity: status.identity,
        login: status.login
      });
    } catch (error) {
      results.push({
        worker: config.workerLabel,
        account: assignment.account,
        port: assignment.port,
        profileId: assignment.profileId,
        ok: false,
        error: safeErrorCode(error)
      });
    }
  }

  for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`);
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0 && args.deleteConfig) await rm(configPath, { force: true });
  if (failed.length > 0) process.exitCode = 1;
}

function parseArgs(argv) {
  const configIndex = argv.indexOf("--config");
  if (configIndex < 0 || !argv[configIndex + 1]) throw new Error("--config is required");
  return { config: argv[configIndex + 1], deleteConfig: argv.includes("--delete-config") };
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function normalizeWebSocketUrl(value, port) {
  const url = new URL(value);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return url.toString();
}

async function requestJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("cdp_http_unavailable");
  return response.json();
}

async function evaluate(wsUrl, expression) {
  const response = await cdpCommand(wsUrl, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response?.exceptionDetails) throw new Error("cdp_evaluation_failed");
  return response?.result?.value;
}

function cdpCommand(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = ++requestId;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("cdp_command_timeout"));
    }, 8_000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id, method, params })));
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.close();
      if (message.error) reject(new Error("cdp_command_failed"));
      else resolve(message.result);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("cdp_websocket_failed"));
    });
  });
}

function safeErrorCode(error) {
  const message = error instanceof Error ? error.message : "unknown_error";
  return /^[a-z0-9_ -]+$/i.test(message) ? message : "operation_failed";
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: safeErrorCode(error) })}\n`);
    process.exitCode = 1;
  });
}
