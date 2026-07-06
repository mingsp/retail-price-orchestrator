import WebSocket from "ws";
import type { WorkerConfig } from "./config.js";
import { buildHeartbeat, buildRegister } from "./local-snapshot.js";

export function startWorkerConnection(config: WorkerConfig): void {
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let reconnectAttempt = 0;

  const connect = () => {
    const url = new URL("/ws/worker", config.masterBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("workerId", config.worker.workerId);

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${config.workerSharedToken}`
      }
    });

    ws.on("open", () => {
      reconnectAttempt = 0;
      ws.send(JSON.stringify(buildRegister(config)));
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(buildHeartbeat(config)));
        }
      }, config.heartbeatIntervalMs);
    });

    ws.on("message", (raw) => {
      console.log(`[master] ${String(raw)}`);
    });

    ws.on("close", () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      scheduleReconnect();
    });

    ws.on("error", (error) => {
      console.error("[worker] websocket error", error.message);
    });
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
    reconnectAttempt++;
    reconnectTimer = setTimeout(connect, delay);
  };

  connect();
}

