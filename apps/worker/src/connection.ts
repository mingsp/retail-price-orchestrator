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
        Authorization: `Bearer ${config.workerToken}`
      }
    });
    let lastHeartbeatSentAt = 0;

    ws.on("open", () => {
      reconnectAttempt = 0;
      ws.send(JSON.stringify(buildRegister(config)));
      const sendHeartbeat = () => {
        if (ws.readyState === WebSocket.OPEN) {
          lastHeartbeatSentAt = Date.now();
          buildHeartbeat(config)
            .then((heartbeat) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(heartbeat));
            })
            .catch((error) => {
              console.error("[worker] failed to build heartbeat", error.message);
            });
        }
      };
      sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, config.heartbeatIntervalMs);
    });

    ws.on("message", (raw) => {
      const text = String(raw);
      try {
        const message = JSON.parse(text) as { type?: string; receivedAt?: string };
        if (message.type === "master.heartbeat_ack" && message.receivedAt && lastHeartbeatSentAt > 0) {
          const midpoint = lastHeartbeatSentAt + (Date.now() - lastHeartbeatSentAt) / 2;
          config.worker.clockOffsetMs = Math.round(new Date(message.receivedAt).getTime() - midpoint);
        }
      } catch {
        // The socket stays usable even if a future Master sends a non-JSON diagnostic frame.
      }
      console.log(`[master] ${text}`);
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
