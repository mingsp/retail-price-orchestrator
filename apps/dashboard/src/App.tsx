import { useEffect, useState } from "react";
import type {
  AccountRegistryRow,
  ArtifactRecord,
  CategoryTaskRecord,
  ProfileRegistryRow,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
  TaskStatus,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import {
  connectDashboard,
  fetchArtifacts,
  fetchAccounts,
  fetchProfiles,
  fetchRiskEvents,
  fetchRuns,
  fetchStores,
  fetchTasks,
  fetchWorkers,
  updateAccountStatus,
  updateProfileStatus,
  updateRiskStatus,
  updateTask
} from "./api.js";
import { AccountTable, ProfileTable, RiskEventTable } from "./registry-tables.js";
import { ArtifactTable } from "./artifact-table.js";
import { RunTable, StoreTable, TaskTable } from "./task-tables.js";
import { WorkerStatusTable } from "./worker-status.js";

type View = "workers" | "accounts" | "profiles" | "risks" | "stores" | "runs" | "tasks" | "artifacts";

export function App() {
  const [workers, setWorkers] = useState<WorkerStatusRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRegistryRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRegistryRow[]>([]);
  const [risks, setRisks] = useState<RiskEventRecord[]>([]);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [runs, setRuns] = useState<StoreRunRecord[]>([]);
  const [tasks, setTasks] = useState<CategoryTaskRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [connection, setConnection] = useState("connecting");
  const [view, setView] = useState<View>("workers");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    refreshSnapshots().catch((error) => {
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
        refreshRegistries().catch(console.error);
      }
      if (message.type === "risk.created") {
        setRisks((current) => [message.risk, ...current.filter((risk) => risk.riskId !== message.risk.riskId)]);
      }
      if (message.type === "task.updated") {
        setTasks((current) => upsertBy(current, message.task, "taskId"));
      }
      if (message.type === "artifact.created") {
        setArtifacts((current) => upsertBy(current, message.artifact, "artifactId"));
      }
    });
    ws.onopen = () => setConnection("live");
    ws.onclose = () => setConnection("disconnected");
    ws.onerror = () => setConnection("ws-error");
    return () => ws.close();
  }, []);

  async function refreshSnapshots() {
    const [workerRows, accountRows, profileRows, riskRows, storeRows, runRows, taskRows, artifactRows] = await Promise.all([
      fetchWorkers(),
      fetchAccounts(),
      fetchProfiles(),
      fetchRiskEvents(),
      fetchStores(),
      fetchRuns(),
      fetchTasks(),
      fetchArtifacts()
    ]);
    setWorkers(workerRows);
    setAccounts(accountRows);
    setProfiles(profileRows);
    setRisks(riskRows);
    setStores(storeRows);
    setRuns(runRows);
    setTasks(taskRows);
    setArtifacts(artifactRows);
  }

  async function refreshRegistries() {
    const [accountRows, profileRows] = await Promise.all([fetchAccounts(), fetchProfiles()]);
    setAccounts(accountRows);
    setProfiles(profileRows);
  }

  async function runAction(action: () => Promise<unknown>) {
    try {
      setActionError("");
      await action();
      await refreshSnapshots();
    } catch (error) {
      console.error(error);
      setActionError(error instanceof Error ? error.message : "action failed");
    }
  }

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
        <div className="section-bar">
          <h2>{viewTitle(view)}</h2>
          <nav className="tabs" aria-label="dashboard views">
            <Tab active={view === "workers"} label="Workers" onClick={() => setView("workers")} />
            <Tab active={view === "accounts"} label="Accounts" onClick={() => setView("accounts")} />
            <Tab active={view === "profiles"} label="Profiles" onClick={() => setView("profiles")} />
            <Tab active={view === "risks"} label="Risks" onClick={() => setView("risks")} />
            <Tab active={view === "stores"} label="Stores" onClick={() => setView("stores")} />
            <Tab active={view === "runs"} label="Runs" onClick={() => setView("runs")} />
            <Tab active={view === "tasks"} label="Tasks" onClick={() => setView("tasks")} />
            <Tab active={view === "artifacts"} label="Artifacts" onClick={() => setView("artifacts")} />
          </nav>
        </div>
        {actionError ? <div className="action-error">{actionError}</div> : null}
        {view === "workers" ? <WorkerStatusTable workers={workers} /> : null}
        {view === "accounts" ? (
          <AccountTable
            accounts={accounts}
            onAction={(accountId, status) =>
              runAction(() =>
                updateAccountStatus(accountId, {
                  status,
                  riskLevel: status === "account_blocked" ? "blocked" : status === "safe" ? "normal" : "watch",
                  lastRiskAt: status === "safe" ? null : new Date().toISOString()
                })
              )
            }
          />
        ) : null}
        {view === "profiles" ? (
          <ProfileTable
            profiles={profiles}
            onAction={(profileId, status) =>
              runAction(() =>
                updateProfileStatus(profileId, {
                  status,
                  lastRiskAt: status === "safe" ? null : new Date().toISOString()
                })
              )
            }
          />
        ) : null}
        {view === "risks" ? (
          <RiskEventTable risks={risks} onAction={(riskId, status) => runAction(() => updateRiskStatus(riskId, status))} />
        ) : null}
        {view === "stores" ? <StoreTable stores={stores} /> : null}
        {view === "runs" ? <RunTable runs={runs} /> : null}
        {view === "tasks" ? (
          <TaskTable
            tasks={tasks}
            onAction={(taskId, status: TaskStatus) =>
              runAction(() =>
                updateTask(taskId, {
                  status,
                  lastError: status === "failed" ? "Marked failed from dashboard" : null
                })
              )
            }
          />
        ) : null}
        {view === "artifacts" ? <ArtifactTable artifacts={artifacts} /> : null}
      </section>
    </main>
  );
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={active ? "tab tab-active" : "tab"} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

function viewTitle(view: View) {
  if (view === "accounts") return "账号识别";
  if (view === "profiles") return "Profile/CDP";
  if (view === "risks") return "风险事件";
  if (view === "stores") return "门店";
  if (view === "runs") return "采集批次";
  if (view === "tasks") return "类目任务";
  if (view === "artifacts") return "原始产物";
  return "Worker 状态";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function upsertBy<T, K extends keyof T>(items: T[], item: T, key: K): T[] {
  return [item, ...items.filter((current) => current[key] !== item[key])];
}
