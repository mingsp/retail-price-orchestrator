import { useEffect, useState } from "react";
import type { WorkerStatusRow } from "@retail-orchestrator/shared";
import { connectDashboard, fetchWorkers } from "./api.js";
import { WorkerStatusTable } from "./worker-status.js";

export function App() {
  const [workers, setWorkers] = useState<WorkerStatusRow[]>([]);
  const [connection, setConnection] = useState("connecting");

  useEffect(() => {
    fetchWorkers().then(setWorkers).catch((error) => {
      console.error(error);
      setConnection("http-error");
    });

    const ws = connectDashboard((message) => {
      setConnection("live");
      if (message.type === "dashboard.snapshot") setWorkers(message.workers);
      if (message.type === "worker.updated") {
        setWorkers((current) => {
          const next = current.filter((row) => row.worker.workerId !== message.worker.worker.workerId);
          next.push(message.worker);
          return next.sort((a, b) => a.worker.workerId.localeCompare(b.worker.workerId));
        });
      }
    });
    ws.onopen = () => setConnection("live");
    ws.onclose = () => setConnection("disconnected");
    ws.onerror = () => setConnection("ws-error");
    return () => ws.close();
  }, []);

  return (
    <main>
      <header>
        <div>
          <h1>采集调度控制台</h1>
          <p>Worker 在线状态、账号识别、Profile/CDP 绑定</p>
        </div>
        <span className={`connection connection-${connection}`}>{connection}</span>
      </header>

      <section className="metric-grid">
        <Metric label="Workers" value={workers.length} />
        <Metric label="Online" value={workers.filter((row) => row.worker.status === "online").length} />
        <Metric label="Accounts" value={workers.reduce((sum, row) => sum + row.accounts.length, 0)} />
        <Metric
          label="Risk"
          value={workers.reduce(
            (sum, row) => sum + row.accounts.filter((account) => account.status !== "safe").length,
            0
          )}
        />
      </section>

      <section>
        <h2>Worker 状态</h2>
        <WorkerStatusTable workers={workers} />
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

