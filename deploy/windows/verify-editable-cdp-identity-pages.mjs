import process from "node:process";

let requestId = 0;

function parsePorts(argv) {
  const index = argv.indexOf("--ports");
  if (index < 0 || !argv[index + 1]) throw new Error("--ports is required");
  const ports = argv[index + 1].split(",").map((value) => Number(value.trim()));
  if (ports.length === 0 || ports.some((port) => !Number.isInteger(port))) throw new Error("invalid ports");
  return ports;
}

async function verifyPort(port) {
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5_000) }).then((response) => response.json());
  const page = pages.find((candidate) => candidate.type === "page" && (
    String(candidate.title || "").includes("Retail-Radar CDP Identity")
      || String(candidate.url || "").includes("retail-radar-identity.html")
  ));
  if (!page?.webSocketDebuggerUrl) throw new Error("identity_page_missing");
  const wsUrl = new URL(page.webSocketDebuggerUrl);
  wsUrl.hostname = "127.0.0.1";
  wsUrl.port = String(port);

  const expression = `(() => {
    const editable = ["account", "phone", "owner", "store"];
    const readonly = ["device", "endpoint", "port", "profile"];
    const values = Object.fromEntries(editable.map((id) => [id, document.getElementById(id)?.value || ""]));
    const editableOk = editable.every((id) => document.getElementById(id) && !document.getElementById(id).readOnly);
    const readonlyOk = readonly.every((id) => document.getElementById(id)?.readOnly);
    document.getElementById("save")?.click();
    const key = "retail-radar-identity:" + document.getElementById("profile")?.value;
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    return { editableOk, readonlyOk, hasSave: Boolean(document.getElementById("save")), values, stored };
  })()`;
  const result = await command(wsUrl.toString(), "Runtime.evaluate", { expression, returnByValue: true });
  const value = result?.result?.value;
  const persisted = value?.stored?.savedAt && ["account", "phone", "owner", "store"].every((id) => value.stored.values?.[id] === value.values?.[id]);
  return {
    port,
    ok: Boolean(value?.editableOk && value?.readonlyOk && value?.hasSave && persisted),
    editable: Boolean(value?.editableOk),
    readonlyProtected: Boolean(value?.readonlyOk),
    persisted: Boolean(persisted),
    account: value?.values?.account || "",
    owner: value?.values?.owner || "",
    phoneSuffix: String(value?.values?.phone || "").slice(-4),
    store: value?.values?.store || ""
  };
}

function command(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const id = ++requestId;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("cdp_timeout"));
    }, 8_000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({ id, method, params })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error("cdp_command_failed"));
      else resolve(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("cdp_websocket_failed"));
    });
  });
}

const results = [];
for (const port of parsePorts(process.argv.slice(2))) {
  try {
    results.push(await verifyPort(port));
  } catch (error) {
    results.push({ port, ok: false, error: error instanceof Error ? error.message : "unknown_error" });
  }
}
for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`);
if (results.some((result) => !result.ok)) process.exitCode = 1;
