export async function connectToCdpPage({
  cdpEndpoint,
  targetUrlPart = "",
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  commandTimeoutMs = 90_000
}) {
  const listUrl = new URL("/json/list", cdpEndpoint).toString();
  const response = await fetchImpl(listUrl);
  if (!response.ok) throw new Error(`${response.status} ${listUrl}`);

  const pages = await response.json();
  const page =
    pages.find((item) => item.type === "page" && targetUrlPart && (item.url || "").includes(targetUrlPart)) ||
    pages.find((item) => item.type === "page" && (item.url || "").includes("cactivityapi-sc.waimai.meituan.com")) ||
    pages.find((item) => item.type === "page");

  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`未找到可连接的 CDP 页面 endpoint=${cdpEndpoint}`);
  }

  const ws = new WebSocketImpl(page.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  let closed = false;

  const rejectPending = (reason) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(reason);
    }
    pending.clear();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    rejectPending(new Error("CDP session closed"));
    ws.close();
  };

  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    });
    ws.addEventListener("close", () => {
      closed = true;
      rejectPending(new Error("CDP websocket closed"));
    });

    const send = (method, params = {}, timeout = commandTimeoutMs) => {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`timeout ${method}`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        try {
          ws.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    };

    await send("Runtime.enable");

    const evaluate = async (expression, timeout = 180_000) => {
      const result = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        timeout
      );
      if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result?.result?.value;
    };

    return { page, ws, evaluate, close };
  } catch (error) {
    close();
    throw error;
  }
}
