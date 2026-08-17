import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Database,
  History,
  LayoutDashboard,
  ListChecks,
  Monitor,
  Network,
  Store,
  UserRoundCog
} from "lucide-react";
import type {
  AccountRegistryRow,
  AccountPoolRecord,
  ArtifactRecord,
  BrowserSlotRecord,
  CategoryTaskRecord,
  OperationEventRecord,
  ProductDataQualityGate,
  PriceQualityRecord,
  ProductionReadinessReport,
  ProductSnapshotSummary,
  ProfileRegistryRow,
  BusinessActivityRecord,
  BusinessDeliveryRecord,
  BusinessOverviewRecord,
  RunProgressRecord,
  RiskClusterRecord,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
  TaskStatus,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import {
  connectDashboard,
  createAccountPool,
  createCategoryTasks,
  createRun,
  createStore,
  fetchArtifacts,
  fetchBrowserSlots,
  fetchBusinessActivities,
  fetchBusinessDeliveries,
  fetchBusinessOverview,
  fetchBusinessRuns,
  fetchOperationEvents,
  fetchProductDataQualityGate,
  fetchProductSnapshotSummary,
  fetchProductionReadiness,
  fetchQualityChecks,
  fetchAccounts,
  fetchAccountPool,
  fetchProfiles,
  fetchRiskClusters,
  fetchRiskEvents,
  fetchRuns,
  fetchStores,
  fetchTasks,
  fetchWorkers,
  getBusinessDeliveryDownload,
  migrateTask,
  prepareBusinessDelivery,
  updateAccountStatus,
  updateAccountPool,
  updateProfileStatus,
  updateRiskStatus,
  triggerTaskAction,
  updateTask
} from "./api.js";
import { AccountTable, ProfileTable } from "./registry-tables.js";
import { AccountPoolTable } from "./account-pool-table.js";
import { ArtifactTable } from "./artifact-table.js";
import { CommandCenter } from "./command-center.js";
import { StatusPill } from "./display.js";
import { OperationEventsTable } from "./operation-events-table.js";
import { ResourceMatrix } from "./resource-matrix.js";
import { RiskInterventionStation } from "./risk-intervention.js";
import { StoreRunBoard } from "./store-run-board.js";
import { TaskForms } from "./task-forms.js";
import { StoreTable, TaskTable } from "./task-tables.js";
import { BusinessActivity } from "./business-activity.js";
import { BusinessRuns } from "./business-overview.js";
import { BusinessResults } from "./business-results.js";

type View = "command" | "runs" | "stores" | "tasks" | "activity" | "workers" | "accounts" | "profiles" | "risks" | "results" | "artifacts" | "operations";

interface NavItem {
  view: View;
  label: string;
  meta: string;
  icon: ReactNode;
  active?: (view: View) => boolean;
}

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "采集管理",
    items: [
      { view: "command", label: "调度总览", meta: "任务、资源与风险", icon: <LayoutDashboard className="h-4 w-4" /> },
      {
        view: "runs",
        label: "门店采集进度",
        meta: "全量完成度",
        icon: <Store className="h-4 w-4" />,
      },
      { view: "tasks", label: "类目任务调度", meta: "分配与断点", icon: <ListChecks className="h-4 w-4" /> },
      { view: "activity", label: "实时采集进度", meta: "日志摘要", icon: <Activity className="h-4 w-4" /> }
    ]
  },
  {
    label: "资源与风控",
    items: [
      { view: "workers", label: "采集设备", meta: "在线与任务", icon: <Monitor className="h-4 w-4" /> },
      { view: "accounts", label: "账号池", meta: "库存与使用状态", icon: <UserRoundCog className="h-4 w-4" /> },
      { view: "profiles", label: "浏览器席位", meta: "账号与门店绑定", icon: <UserRoundCog className="h-4 w-4" /> }
    ]
  },
  {
    label: "数据与审计",
    items: [
      { view: "risks", label: "风险处理", meta: "人工介入", icon: <AlertTriangle className="h-4 w-4" /> },
      { view: "results", label: "数据结果", meta: "Excel/CSV", icon: <Database className="h-4 w-4" /> },
      { view: "artifacts", label: "数据归档", meta: "原始数据与质量", icon: <Database className="h-4 w-4" /> },
      { view: "operations", label: "操作记录", meta: "全程留痕", icon: <History className="h-4 w-4" /> },
      { view: "stores", label: "门店与批次配置", meta: "生产配置", icon: <Store className="h-4 w-4" /> }
    ]
  }
];

export function App() {
  const [workers, setWorkers] = useState<WorkerStatusRow[]>([]);
  const [browserSlots, setBrowserSlots] = useState<BrowserSlotRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRegistryRow[]>([]);
  const [accountPool, setAccountPool] = useState<AccountPoolRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileRegistryRow[]>([]);
  const [risks, setRisks] = useState<RiskEventRecord[]>([]);
  const [riskClusters, setRiskClusters] = useState<RiskClusterRecord[]>([]);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [runs, setRuns] = useState<StoreRunRecord[]>([]);
  const [tasks, setTasks] = useState<CategoryTaskRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [qualityChecks, setQualityChecks] = useState<PriceQualityRecord[]>([]);
  const [operationEvents, setOperationEvents] = useState<OperationEventRecord[]>([]);
  const [productSummary, setProductSummary] = useState<ProductSnapshotSummary>({
    productCount: 0,
    skuCount: 0,
    frontDisplayPriceCount: 0,
    userFinalPriceCount: 0
  });
  const [productQualityGate, setProductQualityGate] = useState<ProductDataQualityGate | null>(null);
  const [readiness, setReadiness] = useState<ProductionReadinessReport | null>(null);
  const [businessOverview, setBusinessOverview] = useState<BusinessOverviewRecord>();
  const [businessRuns, setBusinessRuns] = useState<RunProgressRecord[]>([]);
  const [businessActivities, setBusinessActivities] = useState<BusinessActivityRecord[]>([]);
  const [deliveries, setDeliveries] = useState<BusinessDeliveryRecord[]>([]);
  const [connection, setConnection] = useState("connecting");
  const [view, setView] = useState<View>("command");
  const [actionError, setActionError] = useState("");
  const [busyRunId, setBusyRunId] = useState<string>();
  const activeTaskCount = tasks.filter((task) => ["claimed", "collecting", "uploading", "validating"].includes(task.status)).length;

  useEffect(() => {
    let hasConnected = false;
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
      if (message.type === "quality.created") {
        setQualityChecks((current) => upsertBy(current, message.quality, "qualityId"));
      }
    }, (state) => {
      setConnection(state);
      if (state !== "live") return;
      if (hasConnected) refreshSnapshots().catch(console.error);
      hasConnected = true;
    });
    const businessTimer = window.setInterval(() => refreshBusinessData().catch(console.error), 20_000);
    return () => {
      window.clearInterval(businessTimer);
      ws.close();
    };
  }, []);

  async function refreshSnapshots() {
    const failures = (await Promise.all([
      loadModule("采集设备", fetchWorkers(), setWorkers),
      loadModule("浏览器席位", fetchBrowserSlots(), setBrowserSlots),
      loadModule("账号", fetchAccounts(), setAccounts),
      loadModule("账号池", fetchAccountPool(), setAccountPool),
      loadModule("浏览器席位", fetchProfiles(), setProfiles),
      loadModule("风险事件", fetchRiskEvents(), setRisks),
      loadModule("风险聚合", fetchRiskClusters(), setRiskClusters),
      loadModule("门店", fetchStores(), setStores),
      loadModule("采集批次", fetchRuns(), setRuns),
      loadModule("类目任务", fetchTasks(), setTasks),
      loadModule("原始数据", fetchArtifacts(), setArtifacts),
      loadModule("质量检查", fetchQualityChecks(), setQualityChecks),
      loadModule("操作记录", fetchOperationEvents(), setOperationEvents),
      loadModule("商品汇总", fetchProductSnapshotSummary({ scope: "current_valid" }), setProductSummary),
      loadModule("数据质量", fetchProductDataQualityGate({ scope: "current_valid" }), setProductQualityGate),
      loadModule("开采前检查", fetchProductionReadiness(), setReadiness)
    ])).filter((label): label is string => Boolean(label));
    if (failures.length) setActionError(`部分数据暂未同步：${failures.join("、")}。系统会自动重试。`);
    else setActionError((current) => current.startsWith("部分数据暂未同步") ? "" : current);
    await refreshBusinessData();
  }

  async function refreshBusinessData() {
    const results = await Promise.allSettled([
      fetchBusinessOverview(),
      fetchBusinessRuns(),
      fetchBusinessActivities(80),
      fetchBusinessDeliveries()
    ]);
    if (results[0].status === "fulfilled") setBusinessOverview(results[0].value);
    if (results[1].status === "fulfilled") setBusinessRuns(results[1].value);
    if (results[2].status === "fulfilled") setBusinessActivities(results[2].value);
    if (results[3].status === "fulfilled") setDeliveries(results[3].value);
  }

  async function refreshRegistries() {
    const [accountRows, poolRows, profileRows, slotRows] = await Promise.all([fetchAccounts(), fetchAccountPool(), fetchProfiles(), fetchBrowserSlots()]);
    setAccounts(accountRows);
    setAccountPool(poolRows);
    setProfiles(profileRows);
    setBrowserSlots(slotRows);
  }

  async function runAction(action: () => Promise<unknown>) {
    try {
      setActionError("");
      await action();
      await refreshSnapshots();
    } catch (error) {
      console.error(error);
      setActionError(friendlyErrorMessage(error));
    }
  }

  async function prepareDelivery(runId: string) {
    setBusyRunId(runId);
    try {
      setActionError("");
      const result = await prepareBusinessDelivery(runId);
      window.location.assign(result.url);
      await refreshBusinessData();
    } catch (error) {
      setActionError(friendlyErrorMessage(error, "业务文件暂时无法生成"));
    } finally {
      setBusyRunId(undefined);
    }
  }

  async function downloadDelivery(runId: string) {
    setBusyRunId(runId);
    try {
      setActionError("");
      window.location.assign(await getBusinessDeliveryDownload(runId));
    } catch (error) {
      setActionError(friendlyErrorMessage(error, "文件暂时无法下载"));
    } finally {
      setBusyRunId(undefined);
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
            <div className="sidebar-brand-title">商圈比价</div>
            <div className="sidebar-brand-subtitle">数据采集与调度系统</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="系统功能导航">
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
            <span className="text-sm font-semibold text-slate-700">实时连接</span>
            <StatusPill status={connection} className="!py-0.5" />
          </div>
          <div className="mt-3 text-xs font-medium text-slate-500">采集进度与风险事件持续同步</div>
          <div className="mt-2.5 h-px bg-slate-200/80" />
          <div className="mt-2.5 text-xs leading-relaxed text-slate-500">连接中断后系统会自动恢复，并重新核对最新任务状态。</div>
        </div>
      </aside>

      <main className="content-shell">
        <header className="content-header">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-900" />
              商圈比价采集与调度
            </div>
            <h1 className="m-0 mt-1.5 text-2xl font-bold tracking-tight text-slate-900">{viewTitle(view)}</h1>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white/90 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
              <Boxes className="h-4 w-4 text-slate-800" />
              <span>{activeTaskCount > 0 ? `运行中 ${activeTaskCount} 个任务` : "当前无运行任务"}</span>
            </div>
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
            productSummary={productSummary}
            businessOverview={businessOverview}
            businessActivities={businessActivities}
            readiness={readiness}
            connection={connection}
            onNavigate={(target) => setView(target)}
          />
        ) : null}
        {view === "workers" ? (
          <ResourceMatrix
            workers={workers}
            tasks={tasks}
            slots={browserSlots}
            accounts={accounts}
            profiles={profiles}
            stores={stores}
            onAction={runAction}
          />
        ) : null}
        {view === "accounts" ? (
          <div className="space-y-6">
            <AccountPoolTable
              accounts={accountPool}
              onCreate={(input) => runAction(() => createAccountPool(input))}
              onUpdate={(accountId, input) => runAction(() => updateAccountPool(accountId, input))}
            />
            <AccountTable
              accounts={accounts}
              tasks={tasks}
              workers={workers}
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
          </div>
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
          <RiskInterventionStation
            risks={risks}
            riskClusters={riskClusters}
            tasks={tasks}
            workers={workers}
            slots={browserSlots}
            onRiskAction={(riskId, status) => runAction(() => updateRiskStatus(riskId, status))}
            onTaskAction={(taskId, action) => runAction(() => triggerTaskAction(taskId, { action }))}
            onTaskMigrate={(taskId, targetSlotId) => runAction(() => migrateTask(taskId, { targetSlotId }))}
          />
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
        {view === "runs" ? (
          <div className="space-y-6">
            <BusinessRuns runs={businessRuns} />
            <StoreRunBoard runs={runs} tasks={tasks} onOpenStores={() => setView("stores")} />
          </div>
        ) : null}
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
        {view === "operations" ? <OperationEventsTable events={operationEvents} /> : null}
        {view === "activity" ? <BusinessActivity activities={businessActivities} /> : null}
        {view === "results" ? (
          <BusinessResults
            deliveries={deliveries}
            busyRunId={busyRunId}
            onPrepare={(runId) => void prepareDelivery(runId)}
            onDownload={(runId) => void downloadDelivery(runId)}
          />
        ) : null}
        {view === "artifacts" ? (
          <ArtifactTable
            artifacts={artifacts}
            qualityChecks={qualityChecks}
            productSummary={productSummary}
            productQualityGate={productQualityGate}
          />
        ) : null}
      </main>
    </div>
  );
}

function SideNav({ active, icon, label, meta, onClick }: { active: boolean; icon: ReactNode; label: string; meta: string; onClick: () => void }) {
  return (
    <button
      aria-current={active ? "page" : undefined}
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
  if (view === "command") return "采集调度总览";
  if (view === "accounts") return "采集账号池";
  if (view === "profiles") return "浏览器席位与账号绑定";
  if (view === "risks") return "风险处理与人工介入";
  if (view === "stores") return "门店与采集批次配置";
  if (view === "runs") return "门店采集进度";
  if (view === "tasks") return "类目任务调度";
  if (view === "activity") return "实时采集进度";
  if (view === "operations") return "生产操作记录";
  if (view === "artifacts") return "数据归档与完整性";
  if (view === "results") return "数据结果与交付";
  return "采集设备状态";
}

function upsertBy<T, K extends keyof T>(items: T[], item: T, key: K): T[] {
  return [item, ...items.filter((current) => current[key] !== item[key])];
}

async function loadModule<T>(label: string, request: Promise<T>, apply: (value: T) => void): Promise<string | undefined> {
  try {
    apply(await request);
    return undefined;
  } catch (error) {
    console.error(`[dashboard] ${label} sync failed`, error);
    return label;
  }
}

function friendlyErrorMessage(error: unknown, fallback = "操作暂未完成，请稍后重试"): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/409|stale_task_lease/i.test(message)) return "任务状态刚刚发生变化，系统已刷新，请重新确认后操作。";
  if (/401|403|unauthorized/i.test(message)) return "当前操作未获授权，请联系系统负责人确认运行配置。";
  if (/timeout|超时|network|网络|5\d\d/i.test(message)) return "数据服务暂时不可用，系统会自动恢复，请稍后重试。";
  return fallback;
}
