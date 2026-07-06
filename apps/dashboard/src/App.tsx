import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Boxes,
  Database,
  LayoutDashboard,
  ListChecks,
  Monitor,
  Network,
  Store,
  UserRoundCog
} from "lucide-react";
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
  createCategoryTasks,
  createRun,
  createStore,
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
import { CommandCenter } from "./command-center.js";
import { labelConnection } from "./display.js";
import { TaskForms } from "./task-forms.js";
import { RunTable, StoreTable, TaskTable } from "./task-tables.js";
import { WorkerStatusTable } from "./worker-status.js";

type View = "command" | "workers" | "accounts" | "profiles" | "risks" | "stores" | "runs" | "tasks" | "artifacts";

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
  const [view, setView] = useState<View>("command");
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
      setActionError(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(135deg,#eef4fb_0%,#f8fbff_48%,#eef2ff_100%)] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-20 w-72 border-r border-white/70 bg-white/72 px-5 py-6 shadow-soft backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white shadow-glow">
            <Network className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold">Retail-Radar</div>
            <div className="text-xs text-slate-500">竞对价格监控与调度中台</div>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          <SideNav active={view === "command"} icon={<LayoutDashboard className="h-4 w-4" />} label="作战指挥大盘" onClick={() => setView("command")} />
          <SideNav active={view === "stores" || view === "runs"} icon={<Store className="h-4 w-4" />} label="调度与批次" onClick={() => setView("stores")} />
          <SideNav active={view === "tasks"} icon={<ListChecks className="h-4 w-4" />} label="类目任务" onClick={() => setView("tasks")} />
          <SideNav active={view === "workers"} icon={<Monitor className="h-4 w-4" />} label="资源拓扑" onClick={() => setView("workers")} />
          <SideNav active={view === "accounts"} icon={<UserRoundCog className="h-4 w-4" />} label="账号识别" onClick={() => setView("accounts")} />
          <SideNav active={view === "profiles"} icon={<UserRoundCog className="h-4 w-4" />} label="Profile/CDP" onClick={() => setView("profiles")} />
          <SideNav active={view === "risks"} icon={<AlertTriangle className="h-4 w-4" />} label="风控干预台" onClick={() => setView("risks")} />
          <SideNav active={view === "artifacts"} icon={<Database className="h-4 w-4" />} label="数据资产" onClick={() => setView("artifacts")} />
        </nav>

        <div className="absolute bottom-5 left-5 right-5 rounded-lg border border-slate-200 bg-slate-950 p-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">实时连接</span>
            <span className={`connection connection-${connection}`}>{labelConnection(connection)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <span>Master 17890</span>
            <span>Dashboard 2808</span>
          </div>
        </div>
      </aside>

      <main className="ml-72 min-h-screen px-8 py-7">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-blue-700">即时零售竞对价格监控</div>
            <h1 className="m-0 mt-1 text-2xl font-semibold tracking-normal">{viewTitle(view)}</h1>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-white/70 bg-white/80 px-4 py-2 text-sm text-slate-600 shadow-sm backdrop-blur">
            <Boxes className="h-4 w-4 text-blue-600" />
            多设备 · 多账号 · 低频合规采集
          </div>
        </header>

        {actionError ? <div className="action-error">{actionError}</div> : null}
        {view === "command" ? (
          <CommandCenter
            workers={workers}
            accounts={accounts}
            risks={risks}
            stores={stores}
            runs={runs}
            tasks={tasks}
            artifacts={artifacts}
            connection={connection}
            onNavigate={(target) => setView(target)}
          />
        ) : null}
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
        {view === "stores" ? (
          <>
            <TaskForms
              stores={stores}
              runs={runs}
              onCreateStore={(input) =>
                runAction(() =>
                  createStore({
                    ...input,
                    platform: "meituan_h5",
                    status: "active",
                    collectionPolicy: { pace: "low", assignment: "category_split" }
                  })
                )
              }
              onCreateRun={(input) => runAction(() => createRun(input))}
              onCreateTasks={(runId, rows) =>
                runAction(() =>
                  createCategoryTasks(
                    runId,
                    rows.map((row, index) => ({
                      categoryName: row.categoryName,
                      categoryOrder: index + 1,
                      priority: (index + 1) * 10,
                      expectedItems: row.expectedItems,
                      cursor: row.categoryTag ? { categoryTag: row.categoryTag } : {}
                    }))
                  )
                )
              }
            />
            <StoreTable stores={stores} />
          </>
        ) : null}
        {view === "runs" ? <RunTable runs={runs} /> : null}
        {view === "tasks" ? (
          <TaskTable
            tasks={tasks}
            onAction={(taskId, status: TaskStatus) =>
              runAction(() =>
                updateTask(taskId, {
                  status,
                  lastError: status === "failed" ? "由控制台标记失败" : null
                })
              )
            }
          />
        ) : null}
        {view === "artifacts" ? <ArtifactTable artifacts={artifacts} /> : null}
      </main>
    </div>
  );
}

function SideNav({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition ${
        active ? "bg-slate-950 text-white shadow-soft" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
      }`}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function viewTitle(view: View) {
  if (view === "command") return "作战指挥大盘";
  if (view === "accounts") return "账号识别";
  if (view === "profiles") return "Profile/CDP";
  if (view === "risks") return "风险事件";
  if (view === "stores") return "门店";
  if (view === "runs") return "采集批次";
  if (view === "tasks") return "类目任务";
  if (view === "artifacts") return "原始产物";
  return "Worker 状态";
}

function upsertBy<T, K extends keyof T>(items: T[], item: T, key: K): T[] {
  return [item, ...items.filter((current) => current[key] !== item[key])];
}
