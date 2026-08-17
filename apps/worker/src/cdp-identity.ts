import http from "node:http";
import WebSocket from "ws";
import type { CdpEndpointSnapshot } from "@retail-orchestrator/shared";
import type { WorkerConfig } from "./config.js";

interface CdpPage {
  id?: string;
  title?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface IdentityValues {
  phone?: string;
  owner?: string;
  store?: string;
  account?: string;
}

interface MeituanPageObservation {
  title: string;
  text: string;
}

interface CdpVersion {
  webSocketDebuggerUrl?: string;
}

export interface PureCollectorProfileAudit {
  safe: boolean;
  forbiddenDomains: string[];
}

const MERCHANT_COOKIE_DOMAIN_PATTERNS = [
  /(^|\.)epassport\.meituan\.com$/i,
  /(^|\.)shangoue\.meituan\.com$/i,
  /(^|\.)waimaie\.meituan\.com$/i
];

let cdpRequestSequence = 0;

export function allocateCdpRequestId(): number {
  cdpRequestSequence = (cdpRequestSequence % 2_000_000_000) + 1;
  return cdpRequestSequence;
}

export async function readCdpIdentitySnapshots(
  config: WorkerConfig,
  endpoints: CdpEndpointSnapshot[] = config.cdpEndpoints
): Promise<CdpEndpointSnapshot[]> {
  const snapshots = await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        return await readCdpEndpointSnapshot(endpoint);
      } catch (error) {
        const protectedStatus = ["idle", "profile_risk", "retired"].includes(endpoint.status);
        return {
          ...endpoint,
          status: protectedStatus ? endpoint.status : "unknown" as const,
          manualNote: `CDP unreachable: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    })
  );
  return snapshots;
}

export function findForbiddenMerchantCookieDomains(domains: string[]): string[] {
  return [...new Set(
    domains
      .map((domain) => domain.trim().replace(/^\./, "").toLowerCase())
      .filter((domain) => MERCHANT_COOKIE_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain)))
  )].sort();
}

export async function auditPureCollectorProfile(endpoint: CdpEndpointSnapshot): Promise<PureCollectorProfileAudit> {
  const version = await requestJson<CdpVersion>(new URL("/json/version", endpoint.endpointUrl), "GET");
  if (!version.webSocketDebuggerUrl) throw new Error("CDP browser websocket is unavailable");
  const response = await cdpCommand(
    normalizeCdpWebSocketUrl(version.webSocketDebuggerUrl, endpoint.endpointUrl),
    "Storage.getCookies"
  );
  const domains = Array.isArray(response?.result?.cookies)
    ? response.result.cookies.map((cookie: { domain?: unknown }) => typeof cookie.domain === "string" ? cookie.domain : "")
    : [];
  const forbiddenDomains = findForbiddenMerchantCookieDomains(domains);
  return { safe: forbiddenDomains.length === 0, forbiddenDomains };
}

export async function readCdpEndpointSnapshot(endpoint: CdpEndpointSnapshot): Promise<CdpEndpointSnapshot> {
  const pages = await requestJson<CdpPage[]>(new URL("/json/list", endpoint.endpointUrl), "GET");
  const identity = pages.find((page) => isIdentityPage(page, endpoint));
  const meituanPage = pages.find((page) => page.type === "page" && page.url?.includes("waimai.meituan.com"));
  // Background identity tabs can be frozen by Chromium. Their editable labels are
  // advisory; the Master slot binding remains authoritative for task ownership.
  const values: IdentityValues = identity?.webSocketDebuggerUrl
    ? await readIdentityValues(normalizeCdpWebSocketUrl(identity.webSocketDebuggerUrl, endpoint.endpointUrl)).catch(() => ({}))
    : {};
  const maskedLogin = values.phone ? maskPhone(values.phone) : endpoint.maskedLogin;
  const titleOnlyState = meituanPage
    ? classifyMeituanPageState(meituanPage.title || "", "")
    : undefined;
  let observation: MeituanPageObservation | undefined;
  let observationError: unknown;
  if (titleOnlyState?.status === "unknown" && meituanPage?.webSocketDebuggerUrl) {
    try {
      observation = await readMeituanPageObservation(
        normalizeCdpWebSocketUrl(meituanPage.webSocketDebuggerUrl, endpoint.endpointUrl)
      );
    } catch (error) {
      observationError = error;
    }
  }
  const pageState = observation
    ? classifyMeituanPageState(observation.title || meituanPage?.title || "", observation.text)
    : titleOnlyState || { status: "unknown" as const, note: "\u672a\u627e\u5230\u95e8\u5e97\u9875" };
  const manualNote = observationError && pageState.status === "unknown"
    ? `Page connected, body probe unavailable: ${observationError instanceof Error ? observationError.message : String(observationError)}`
    : pageState.note;
  const protectedStatus = ["profile_risk", "retired"].includes(endpoint.status);
  return {
    ...endpoint,
    status: protectedStatus ? endpoint.status : pageState.status,
    accountDisplayName: values.account || endpoint.accountDisplayName,
    maskedLogin,
    operatorOwner: values.owner || endpoint.operatorOwner,
    targetStoreName: values.store || endpoint.targetStoreName,
    lastSeenUrl: meituanPage?.url || endpoint.lastSeenUrl,
    lastSeenTitle: observation?.title || meituanPage?.title || identity?.title || endpoint.lastSeenTitle,
    manualNote
  };
}

export function normalizeCdpWebSocketUrl(webSocketUrl: string, endpointUrl?: string): string {
  if (!endpointUrl) return webSocketUrl;
  const websocket = new URL(webSocketUrl);
  const endpoint = new URL(endpointUrl);
  websocket.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  websocket.hostname = endpoint.hostname;
  websocket.port = endpoint.port;
  return websocket.toString();
}

export function classifyMeituanPageState(title: string, text: string): {
  status: "ready" | "login_required" | "manual_required" | "unknown";
  note: string;
} {
  const content = `${title}\n${text}`;
  if (/\u9a8c\u8bc1\u4e2d\u5fc3|\u9a8c\u8bc1\u7801|\u8eab\u4efd\u6838\u5b9e|\u8eab\u4efd\u9a8c\u8bc1|\u6ed1\u5757/.test(content)) {
    return { status: "manual_required", note: "\u9875\u9762\u9700\u8981\u4eba\u5de5\u9a8c\u8bc1" };
  }
  if (/^\s*\u767b\u5f55\s*$/.test(title) || /\u8bf7\u767b\u5f55|\u624b\u673a\u53f7\u767b\u5f55|\u8f93\u5165\u624b\u673a\u53f7/.test(content)) {
    return { status: "login_required", note: "\u9875\u9762\u9700\u8981\u767b\u5f55\u8d26\u53f7" };
  }
  if (/403|418|\u53d1\u73b0\u5f02\u5e38|\u8bf7\u6c42\u5f02\u5e38|\u62d2\u7edd\u64cd\u4f5c/.test(content)) {
    return { status: "manual_required", note: "\u95e8\u5e97\u9875\u5f02\u5e38\uff0c\u9700\u8981\u4eba\u5de5\u5904\u7406" };
  }
  if (/\u641c\u7d22\u5e97\u5185\u5546\u54c1/.test(content) && /\u6708\u552e|\u9009\u89c4\u683c|\u5546\u54c1/.test(content)) {
    return { status: "ready", note: "\u95e8\u5e97\u5546\u54c1\u9875\u53ef\u89c1" };
  }
  return { status: "unknown", note: "\u9875\u9762\u5df2\u8fde\u63a5\uff0c\u4f46\u5c1a\u672a\u786e\u8ba4\u5546\u54c1\u53ef\u89c1" };
}

function isIdentityPage(page: CdpPage, endpoint: CdpEndpointSnapshot): boolean {
  if (page.type !== "page") return false;
  const title = page.title || "";
  return title.includes(`CDP ${endpoint.port}`) || title.includes("Retail-Radar CDP Identity");
}

async function readIdentityValues(wsUrl: string): Promise<IdentityValues> {
  const expression = `(() => {
    const value = (id) => document.getElementById(id)?.value?.trim?.() || "";
    return {
      phone: value("phone"),
      owner: value("owner"),
      store: value("store"),
      account: value("account")
    };
  })()`;
  const response = await cdpEvaluate(wsUrl, expression);
  return response?.result?.result?.value || {};
}

async function readMeituanPageObservation(wsUrl: string): Promise<MeituanPageObservation> {
  const expression = `(() => ({
    title: document.title || "",
    text: (document.body?.innerText || "").slice(0, 3000)
  }))()`;
  const response = await cdpEvaluate(wsUrl, expression);
  return response?.result?.result?.value || { title: "", text: "" };
}

function cdpEvaluate(wsUrl: string, expression: string): Promise<any> {
  return cdpCommand(wsUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true
  });
}

function cdpCommand(wsUrl: string, method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = allocateCdpRequestId();
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP command timeout: ${method}`));
    }, 10_000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          id,
          method,
          params
        })
      );
    });
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.close();
      resolve(message);
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function requestJson<T>(url: URL, method: "GET" | "PUT"): Promise<T> {
  return requestText(url, method).then((body) => JSON.parse(body) as T);
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

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(7)}`;
  if (value.includes("*")) return value;
  return value.length > 6 ? `${value.slice(0, 2)}****${value.slice(-2)}` : value;
}
