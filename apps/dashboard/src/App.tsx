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
import { AccountTable, ProfileTable } from "./registry-tables.js";
import { ArtifactTable } from "./artifact-table.js";
import { CommandCenter } from "./command-center.js";
import { labelConnection } from "./display.js";
import { ResourceMatrix } from "./resource-matrix.js";
import { RiskInterventionStation } from "./risk-intervention.js";
import { TaskForms } from "./task-forms.js";
import { RunTable, StoreTable, TaskTable } from "./task-tables.js";

type View = "command" | "workers" | "accounts" | "profiles" | "risks" | "stores" | "runs" | "tasks" | "artifacts";

interface NavItem {
  view: View;
  label: string;
  meta: string;
  icon: ReactNode;
  active?: (view: View) => boolean;
}

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "作战",
    items: [
      { view: "command", label: "作战指挥大盘", meta: "全局态势", icon: <LayoutDashboard className="h-4 w-4" /> },
      {
        view: "stores",
        label: "调度与批次",
        meta: "门店计划",
        icon: <Store className="h-4 w-4" />,
        active: (view) => view === "stores" || view === "runs"
      },
      { view: "tasks", label: "类目任务", meta: "任务切片", icon: <ListChecks className="h-4 w-4" /> }
    ]
  },
  {
    label: "资源",
    items: [
      { view: "workers", label: "资源拓扑", meta: "设备心跳", icon: <Monitor className="h-4 w-4" /> },
      { view: "accounts", label: "账号识别", meta: "账号状态", icon: <UserRoundCog className="h-4 w-4" /> },
      { view: "profiles", label: "Profile/CDP", meta: "浏览器绑定", icon: <UserRoundCog className="h-4 w-4" /> }
    ]
  },
  {
    label: "闭环",
    items: [
      { view: "risks", label: "风控干预台", meta: "人工处理", icon: <AlertTriangle className="h-4 w-4" /> },
      { view: "artifacts", label: "数据资产", meta: "产物归档", icon: <Database className="h-4 w-4" /> }
    ]
  }
];

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
    <div className="app-shell">
      <aside className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <Network className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="sidebar-brand-title">Retail-Radar</div>
            <div className="sidebar-brand-subtitle">竞对价格监控与调度中台</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Retail-Radar modules">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <SideNav
                  active={item.active ? item.active(view) : view === item.view}
                  icon={item.icon}
                  key={item.view}
                  label={item.label}
                  meta={item.meta}
                  onClick={() => setView(item.view)}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-runtime-card">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">实时连接</span>
            <span className={`connection connection-${connection}`}>{labelConnection(connection)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <span>Master 17890</span>
            <span>Dashboard 2808</span>
          </div>
          <div className="mt-3 h-px bg-white/10" />
          <div className="mt-3 text-xs leading-5 text-slate-400">Worker 心跳、风险事件、产物上传通过 WebSocket 实时回传。</div>
        </div>
      </aside>

      <main className="content-shell">
        <header className="content-header">
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
        {view === "workers" ? <ResourceMatrix workers={workers} /> : null}
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
        {view === "risks" ? <RiskInterventionStation risks={risks} onAction={(riskId, status) => runAction(() => updateRiskStatus(riskId, status))} /> : null}
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

function SideNav({ active, icon, label, meta, onClick }: { active: boolean; icon: ReactNode; label: string; meta: string; onClick: () => void }) {
  return (
    <button
      className={`nav-item ${active ? "active" : ""}`}
      type="button"
      onClick={onClick}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-text">
        <span className="nav-label">{label}</span>
        <span className="nav-meta">{meta}</span>
      </span>
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
