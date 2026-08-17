import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  HardDriveUpload,
  ListChecks,
  Monitor,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Store,
  TimerReset,
  Users,
  Wifi,
  WifiOff,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  AccountRegistryRow,
  ArtifactRecord,
  BusinessActivityRecord,
  BusinessOverviewRecord,
  CategoryTaskRecord,
  ProductSnapshotSummary,
  ProductionReadinessReport,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import { formatNumber, labelConnection, labelStatus, StatusPill } from "./display.js";
import { artifactDisplayName, safeOperationalText } from "./safe-display.js";
import { buildTruthfulRunProgress, reconcileAccountOperationalTruth } from "./truth-metrics.js";

interface Props {
  workers: WorkerStatusRow[];
  accounts: AccountRegistryRow[];
  risks: RiskEventRecord[];
  stores: StoreRecord[];
  runs: StoreRunRecord[];
  tasks: CategoryTaskRecord[];
  artifacts: ArtifactRecord[];
  productSummary: ProductSnapshotSummary;
  businessOverview?: BusinessOverviewRecord;
  businessActivities: BusinessActivityRecord[];
  readiness: ProductionReadinessReport | null;
  connection: string;
  onNavigate: (view: "risks" | "stores" | "tasks" | "workers" | "artifacts" | "activity") => void;
}

export function CommandCenter({ workers, accounts, risks, stores, runs, tasks, artifacts, productSummary, businessOverview, businessActivities, readiness, connection, onNavigate }: Props) {
  const activeWorkers = workers.filter((row) => row.worker.status === "online").length;
  const offlineWorkers = workers.filter((row) => row.worker.status !== "online").length;
  const liveAccounts = accounts.map((account) => reconcileAccountOperationalTruth(account, tasks));
  const usableSessionAccountIds = new Set(
    workers
      .filter((row) => row.worker.status === "online")
      .flatMap((row) => row.cdpEndpoints || [])
      .filter((endpoint) => ["ready", "running"].includes(endpoint.status) && endpoint.accountId)
      .map((endpoint) => endpoint.accountId as string)
  );
  const healthyAccountCount = liveAccounts.filter(
    (account) => account.status === "safe" && account.riskLevel === "normal" && account.profileStatus === "safe" && usableSessionAccountIds.has(account.accountId)
  ).length;
  const riskAccounts = Math.max(0, liveAccounts.length - healthyAccountCount);
  const healthyAccountRatio = liveAccounts.length ? Math.round((healthyAccountCount / liveAccounts.length) * 100) : undefined;
  const activeRuns = runs.filter((run) => run.status !== "cancelled");
  const completedStores = countCompletedStores(activeRuns, tasks);
  const runningStores = countRunningStores(activeRuns, tasks);
  const alerts = buildAlerts(risks, tasks, workers);
  const progressRows = buildStoreProgress(activeRuns, tasks);
  const feed = buildLiveFeed({ workers, risks, tasks, artifacts, runs, activities: businessActivities });
  const manualBlockedTasks = tasks.filter((task) => isBlockedTask(task.status)).length;
  const openRisks = risks.filter((risk) => risk.status !== "resolved").length;
  const uploadedRawArtifacts = artifacts.filter((artifact) => artifact.kind === "raw_jsonl").length;
  const latestHeartbeatAt = latestDate(workers.map((row) => row.worker.lastSeenAt));
  const workerPreviewRows = buildWorkerPreview(workers, tasks);

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 px-6 py-6 md:px-8 md:py-8 text-white shadow-soft">
        <div className="relative flex flex-col lg:flex-row items-start justify-between gap-6 lg:gap-8">
          <div className="flex-1 min-w-0">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1 text-xs font-semibold text-slate-200">
              <Radio className="h-3.5 w-3.5 text-blue-400 animate-pulse" />
              生产调度实时运行
            </div>
            <h1 className="m-0 text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              多设备采集调度总览
            </h1>
            <p className="mt-2.5 max-w-2xl text-sm md:text-base leading-relaxed text-slate-300 font-normal">
              实时掌握哪台设备、哪个账号正在采哪个门店与类目，以及断点、风险和数据落盘状态。
            </p>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl">
              <HeroMeta label="最近心跳" value={latestHeartbeatAt ? formatTime(latestHeartbeatAt) : "--:--"} />
              <HeroMeta label="阻断任务" value={`${manualBlockedTasks} 个`} tone={manualBlockedTasks ? "red" : "green"} />
              <HeroMeta label="原始数据" value={`${uploadedRawArtifacts} 份`} />
            </div>
          </div>
          <div className="w-full lg:w-56 rounded-lg border border-white/10 bg-white/5 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
              {connection === "live" ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-rose-400" />}
              <span>采集数据链路</span>
            </div>
            <div className="mt-2.5 text-xl font-bold text-white tracking-tight flex items-center justify-between">
              <span>{labelConnection(connection)}</span>
              <StatusPill status={connection} className="!py-0.5 !px-2 !text-[10px]" />
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-slate-400">连接异常时自动恢复并重新同步最新进度。</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <KpiCard
          icon={<Store className="h-5 w-5" />}
          label="当前调度门店"
          value={`${businessOverview?.completedRuns ?? completedStores}/${businessOverview?.targetRuns ?? activeRuns.length}`}
          hint={`进行中 ${businessOverview?.activeRuns ?? runningStores} 个`}
          tone="blue"
        />
        <KpiCard
          icon={<Monitor className="h-5 w-5" />}
          label="采集设备"
          value={`${activeWorkers}/${workers.length || 0}`}
          hint={`空闲/离线 ${offlineWorkers} 个`}
          tone={offlineWorkers ? "amber" : "green"}
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5" />}
          label="可用账号席位"
          value={healthyAccountRatio === undefined ? "--" : `${healthyAccountRatio}%`}
          hint={accounts.length ? `当前可调度 ${healthyAccountCount}/${accounts.length} · 不可用 ${riskAccounts}` : "尚无账号实时数据"}
          tone={riskAccounts ? "red" : "green"}
        />
        <KpiCard
          icon={<Database className="h-5 w-5" />}
          label="当前有效商品"
          value={formatNumber(productSummary.productCount)}
          hint={`SKU 规格 ${formatNumber(productSummary.skuCount)} · 有到手价证据 ${formatNumber(productSummary.userFinalPriceCount)}`}
          tone="indigo"
        />
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <OpsCell
          icon={<ShieldAlert className="h-4 w-4" />}
          label="风险待处理"
          value={`${openRisks} 个`}
          detail="验证码、封禁、403/418"
          tone={openRisks ? "red" : "green"}
          onClick={() => onNavigate("risks")}
        />
        <OpsCell
          icon={<TimerReset className="h-4 w-4" />}
          label="人工阻断任务"
          value={`${manualBlockedTasks} 个`}
          detail="需恢复、换号或休眠"
          tone={manualBlockedTasks ? "amber" : "green"}
          onClick={() => onNavigate("tasks")}
        />
        <OpsCell
          icon={<Server className="h-4 w-4" />}
          label="断联设备"
          value={`${offlineWorkers} 台`}
          detail="基于设备最近通信状态"
          tone={offlineWorkers ? "amber" : "green"}
          onClick={() => onNavigate("workers")}
        />
        <OpsCell
          icon={<HardDriveUpload className="h-4 w-4" />}
          label="产物归档状态"
          value={uploadedRawArtifacts ? "已完成归档" : "等待上传"}
          detail={`${artifacts.length} 个历史记录`}
          tone={uploadedRawArtifacts ? "green" : "neutral"}
          onClick={() => onNavigate("artifacts")}
        />
      </section>

      <ReadinessPanel readiness={readiness} onNavigate={onNavigate} />

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 glass-panel rounded-2xl p-5 md:p-6 flex flex-col justify-between">
          <div>
            <PanelHeader
              icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
              title="待处理事项"
              subtitle="优先处理影响全店数据完整性的风险"
              actionLabel="查看全部"
              onAction={() => onNavigate("risks")}
            />
            <div className="mt-5 space-y-3">
              {alerts.length ? (
                alerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} className={`rounded-xl border p-4 transition-all hover:shadow-sm ${alert.tone === "red" ? "border-rose-200/80 bg-rose-50/60" : "border-amber-200/80 bg-amber-50/60"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className={`text-sm font-bold ${alert.tone === "red" ? "text-rose-800" : "text-amber-800"}`}>{alert.title}</div>
                        <div className="mt-1 text-xs leading-relaxed text-slate-600">{alert.description}</div>
                        <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-500 border border-slate-200/50">
                          {alert.meta}
                        </div>
                      </div>
                      <button
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 shadow-sm"
                        type="button"
                        onClick={() => onNavigate(alert.target)}
                      >
                        去处理 <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="暂无高优风险" description="当前没有需要立即介入处理的验证码、封禁或设备离线事件。" />
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 glass-panel rounded-2xl p-5 md:p-6 flex flex-col justify-between">
          <div>
            <PanelHeader
              icon={<Activity className="h-5 w-5 text-slate-700" />}
              title="当前门店调度进度"
              subtitle="仅统计有效批次和已通过校验的类目"
              actionLabel="管理批次"
              onAction={() => onNavigate("stores")}
            />
            <div className="mt-5 space-y-4">
              {progressRows.length ? (
                progressRows.map((row) => (
                  <div key={row.storeId} className="rounded-xl border border-slate-200/80 bg-white p-4.5 shadow-sm transition-all hover:border-slate-300">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{row.name}</div>
                        <div className="mt-1 text-xs font-medium text-slate-500">
                          已验证 {row.done}/{row.total} 类目 · 采集中 {row.running} · 阻断 {row.blocked}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold text-slate-900 tracking-tight">{row.percent}%</div>
                        <div className="text-[10px] font-semibold text-slate-400">已验证类目</div>
                      </div>
                    </div>
                    <SegmentBar segments={row.segments} />
                  </div>
                ))
              ) : (
                <EmptyState title="暂无门店批次" description="在门店配置页创建对应门店与采集计划批次后即可显示详细切片。" />
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 glass-panel rounded-2xl p-5 md:p-6 flex flex-col justify-between">
          <div>
            <PanelHeader
              icon={<Zap className="h-5 w-5 text-emerald-600" />}
              title="实时采集日志摘要"
              subtitle="持续汇总采集设备、门店、类目与已采商品进度"
              actionLabel="查看全部"
              onAction={() => onNavigate("activity")}
            />
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-inner">
              <div className="flex items-center justify-between border-b border-white/10 bg-slate-900 px-4 py-2.5 font-mono text-[11px] text-slate-400">
                <span>collection-summary.log</span>
                <span className="inline-flex items-center gap-2 text-emerald-400"><Radio className="h-3.5 w-3.5" />实时更新</span>
              </div>
              <div className="max-h-96 min-h-72 space-y-0 overflow-y-auto p-3.5 font-mono text-xs leading-6" aria-live="polite">
                {feed.length ? feed.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 border-b border-white/5 py-2 px-1 text-slate-300 last:border-0">
                    <span className={`shrink-0 font-bold ${item.tone === "green" ? "text-emerald-400" : item.tone === "red" ? "text-rose-400" : item.tone === "amber" ? "text-amber-300" : "text-blue-400"}`}>
                      {item.time}
                    </span>
                    <span className="flex-1 break-words">{item.text}</span>
                  </div>
                )) : <div className="px-1 py-3 text-slate-500">等待采集设备上报进度...</div>}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 glass-panel rounded-2xl p-5 md:p-6 flex flex-col justify-between">
          <div>
            <PanelHeader
              icon={<Users className="h-5 w-5 text-slate-700" />}
              title="采集设备速览"
              subtitle="查看设备、账号状态及当前类目"
              actionLabel="查看设备"
              onAction={() => onNavigate("workers")}
            />
            <div className="mt-5 space-y-3.5">
              {workerPreviewRows.length ? (
                workerPreviewRows.map((row) => (
                  <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-slate-300" key={row.workerId}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-slate-900">{row.machineLabel}</div>
                        <div className="mt-0.5 truncate text-xs text-slate-400 font-medium">{row.workerId} · {row.networkMode}</div>
                      </div>
                      <StatusPill status={row.status} />
                    </div>
                    <div className="mt-3.5 grid grid-cols-3 gap-2">
                      <ResourceChip label="账号" value={`${row.accountCount}`} />
                      <ResourceChip label="风险" value={`${row.riskAccountCount}`} tone={row.riskAccountCount ? "red" : "green"} />
                      <ResourceChip label="CDP" value={row.cdpPorts || "-"} />
                    </div>
                    <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs leading-relaxed text-slate-600 truncate font-medium">
                      {row.currentWork || "当前没有分配正在运行的采集任务"}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="暂无采集设备在线" description="采集设备连接后，这里会显示账号、浏览器席位和当前类目。" />
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroMeta({ label, value, tone = "blue" }: { label: string; value: string; tone?: "blue" | "green" | "red" }) {
  const borderClass = tone === "green" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : tone === "red" ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-white/10 bg-white/5 text-blue-100";
  return (
    <div className={`rounded-xl border p-3 backdrop-blur ${borderClass}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="mt-1 text-sm font-bold">{value}</div>
    </div>
  );
}

function KpiCard({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: "blue" | "indigo" | "green" | "amber" | "red" }) {
  const iconClass = {
    blue: "bg-slate-100 text-slate-800 border-slate-200/80",
    indigo: "bg-slate-100 text-slate-800 border-slate-200/80",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    amber: "bg-amber-50 text-amber-700 border-amber-200/60",
    red: "bg-rose-50 text-rose-700 border-rose-200/60"
  }[tone];
  return (
    <div className="glass-panel rounded-2xl p-5 md:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex items-start justify-between">
        <div className={`rounded-xl p-3 border ${iconClass}`}>{icon}</div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          实时
        </span>
      </div>
      <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1.5 text-3xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-2 text-xs font-medium text-slate-500">{hint}</div>
    </div>
  );
}

function OpsCell({
  icon,
  label,
  value,
  detail,
  tone,
  onClick
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "green" | "amber" | "red" | "neutral";
  onClick: () => void;
}) {
  const iconClass = {
    green: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200/80 bg-amber-50 text-amber-700",
    red: "border-rose-200/80 bg-rose-50 text-rose-700",
    neutral: "border-slate-200/80 bg-slate-100 text-slate-700"
  }[tone];
  return (
    <button className="glass-panel group rounded-2xl p-5 md:p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card w-full" type="button" onClick={onClick}>
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${iconClass}`}>{icon}</span>
        <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-slate-700 group-hover:translate-x-0.5" />
      </div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1.5 text-xs font-medium text-slate-500">{detail}</div>
    </button>
  );
}

function ReadinessPanel({
  readiness,
  onNavigate
}: {
  readiness: ProductionReadinessReport | null;
  onNavigate: Props["onNavigate"];
}) {
  if (!readiness) {
    return (
      <section className="glass-panel rounded-2xl p-5 md:p-6">
        <PanelHeader
          icon={<ListChecks className="h-5 w-5 text-slate-500" />}
          title="开采前安全检查"
          subtitle="正在核对采集设备、账号、浏览器席位与任务状态..."
          actionLabel="查看设备"
          onAction={() => onNavigate("workers")}
        />
      </section>
    );
  }

  const topIssues = readiness.issues.slice(0, 5);
  const statusText = readiness.status === "ready" ? "完全就绪" : readiness.status === "warning" ? "关注项提示" : "存在阻断";
  const toneClass =
    readiness.status === "ready"
      ? "border-emerald-200/80 bg-emerald-50/60 text-emerald-800"
      : readiness.status === "warning"
        ? "border-amber-200/80 bg-amber-50/60 text-amber-800"
        : "border-rose-200/80 bg-rose-50/60 text-rose-800";

  return (
    <section className="glass-panel rounded-2xl p-5 md:p-6">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3.5">
            <div className={`rounded-xl border p-3 ${toneClass}`}>
              <ListChecks className="h-5 w-5" />
            </div>
            <div>
              <h2 className="m-0 text-lg font-bold text-slate-900">开采前检查</h2>
              <p className="mt-1 text-xs font-medium text-slate-500">开始采集前自动核对设备、账号、浏览器席位和待处理风险。</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            <ResourceChip label="设备在线" value={`${readiness.summary.onlineWorkers}/${readiness.summary.workers}`} tone={readiness.summary.onlineWorkers === readiness.summary.workers ? "green" : "red"} />
            <ResourceChip label="有效账号" value={`${readiness.summary.accounts}`} />
            <ResourceChip label="浏览器席位" value={`${readiness.summary.cdpEndpoints}`} />
            <ResourceChip label="活跃批次" value={`${readiness.summary.activeRuns}`} />
            <ResourceChip label="阻断项" value={`${readiness.summary.blockers}`} tone={readiness.summary.blockers ? "red" : "green"} />
            <ResourceChip label="关注项" value={`${readiness.summary.warnings}`} tone={readiness.summary.warnings ? "red" : "green"} />
          </div>
        </div>
        <div className={`w-full lg:w-44 rounded-xl border px-4 py-3.5 text-left lg:text-right ${toneClass}`}>
          <div className="text-xs font-bold uppercase tracking-wider">当前评估结论</div>
          <div className="mt-1 text-2xl font-extrabold tracking-tight">{statusText}</div>
          <div className="mt-1 text-[11px] opacity-75 font-medium">{formatTime(readiness.generatedAt)}</div>
        </div>
      </div>

      {topIssues.length ? (
        <div className="mt-6 grid gap-2.5">
          {topIssues.map((item) => (
            <div
              key={item.id}
              className={`rounded-xl border px-4 py-3.5 transition-all ${
                item.severity === "blocker" ? "border-rose-200/80 bg-rose-50/60" : item.severity === "warning" ? "border-amber-200/80 bg-amber-50/60" : "border-slate-200/80 bg-slate-50/60"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className={`text-sm font-bold ${item.severity === "blocker" ? "text-rose-800" : item.severity === "warning" ? "text-amber-800" : "text-slate-800"}`}>
                    {item.title}
                  </div>
                  <div className="mt-1 text-xs text-slate-600 leading-relaxed font-normal">{item.detail}</div>
                  <div className="mt-1.5 text-[11px] font-medium text-slate-500">处理建议：{item.action}</div>
                </div>
                <span className="self-start sm:self-center shrink-0 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-sm">
                  {item.area}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3.5 text-xs font-semibold text-emerald-800">
          全量检测未发现阻断项。在启动全自动采集或干预前，请确认对应门店配置 URL 及类目切片处于激活状态。
        </div>
      )}
    </section>
  );
}

function PanelHeader({ icon, title, subtitle, actionLabel, onAction }: { icon: ReactNode; title: string; subtitle: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3.5">
        <div className="rounded-xl bg-slate-100 border border-slate-200/60 p-2.5">{icon}</div>
        <div>
          <h2 className="m-0 text-base md:text-lg font-bold text-slate-900 tracking-tight">{title}</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{subtitle}</p>
        </div>
      </div>
      <button className="self-start sm:self-center rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:border-slate-800 hover:text-slate-900 transition shadow-sm" type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

function SegmentBar({ segments }: { segments: Array<{ status: string; width: number }> }) {
  return (
    <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100 border border-slate-200/50">
      {segments.map((segment, index) => (
        <div
          key={`${segment.status}-${index}`}
          className={
            isCompletedTask(segment.status)
              ? "bg-emerald-500 transition-all duration-300"
              : isRunningTask(segment.status)
                ? "bg-blue-600 animate-pulse"
                : isBlockedTask(segment.status)
                  ? "bg-rose-500"
                  : segment.status === "paused"
                    ? "bg-amber-400"
                    : "bg-slate-300"
          }
          style={{ width: `${segment.width}%` }}
          title={labelStatus(segment.status)}
        />
      ))}
    </div>
  );
}

function ResourceChip({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "red" }) {
  const toneClass = tone === "green" ? "text-emerald-700 bg-emerald-50/60 border-emerald-200/60" : tone === "red" ? "text-rose-700 bg-rose-50/60 border-rose-200/60" : "text-slate-800 bg-slate-50 border-slate-200/80";
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{label}</div>
      <div className="mt-0.5 truncate text-xs font-bold">{value}</div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200/80 bg-white/50 p-8 text-center">
      <CheckCircle2 className="mx-auto h-8 w-8 text-slate-300" />
      <div className="mt-3 text-sm font-bold text-slate-800">{title}</div>
      <div className="mt-1 text-xs font-medium text-slate-500 max-w-sm mx-auto">{description}</div>
    </div>
  );
}

function countCompletedStores(runs: StoreRunRecord[], tasks: CategoryTaskRecord[]) {
  return runs.filter((run) => {
    const rows = tasks.filter((task) => task.runId === run.runId);
    return rows.length > 0 && rows.every((task) => isCompletedTask(task.status));
  }).length;
}

function countRunningStores(runs: StoreRunRecord[], tasks: CategoryTaskRecord[]) {
  return runs.filter((run) => tasks.some((task) => task.runId === run.runId && isRunningTask(task.status))).length;
}

function buildStoreProgress(runs: StoreRunRecord[], tasks: CategoryTaskRecord[]) {
  return runs.map((run) => {
    const rows = tasks.filter((task) => task.runId === run.runId);
    const truth = buildTruthfulRunProgress(rows);
    const done = truth.resolvedCategories;
    const running = rows.filter((task) => isRunningTask(task.status)).length;
    const blocked = rows.filter((task) => isBlockedTask(task.status)).length;
    return {
      storeId: run.runId,
      name: run.storeName || run.storeId,
      total: rows.length,
      done,
      running,
      blocked,
      percent: truth.categoryCompletionPercent,
      segments: rows.length
        ? rows.map((task) => ({ status: task.status, width: 100 / rows.length }))
        : [{ status: "pending", width: 100 }]
    };
  });
}

function buildWorkerPreview(workers: WorkerStatusRow[], tasks: CategoryTaskRecord[]) {
  return workers.slice(0, 4).map((row) => {
    const accounts = row.accounts.map((account) => reconcileAccountOperationalTruth(account, tasks));
    const riskAccounts = accounts.filter((account) => account.status !== "safe" || account.riskLevel !== "normal");
    const workingAccounts = accounts.filter((account) => account.operationalSource === "active_task");
    const primaryWork = workingAccounts[0];
    return {
      workerId: row.worker.workerId,
      machineLabel: row.worker.machineLabel,
      status: row.worker.status,
      networkMode: row.worker.networkMode,
      accountCount: accounts.length,
      riskAccountCount: riskAccounts.length,
      cdpPorts: accounts.map((account) => account.cdpPort).filter(Boolean).join(", "),
      currentWork: primaryWork
        ? `${primaryWork.displayName || primaryWork.accountId} · ${primaryWork.currentStoreName || "未知门店"} / ${primaryWork.currentCategoryName || "未知类目"}`
        : ""
    };
  });
}

function buildAlerts(risks: RiskEventRecord[], tasks: CategoryTaskRecord[], workers: WorkerStatusRow[]) {
  const riskAlerts = risks
    .filter((risk) => risk.status !== "resolved")
    .map((risk) => ({
      id: risk.riskId,
      title: `${labelStatus(risk.riskType)} · ${risk.accountId || risk.workerId}`,
      description: safeOperationalText(risk.observed),
      meta: `${risk.storeName || risk.storeId || "未知门店"} / ${risk.categoryName || "未知类目"}`,
      tone: risk.severity === "critical" || risk.severity === "high" ? "red" : "amber",
      target: "risks" as const
    }));
  const taskAlerts = tasks
    .filter((task) => task.status === "manual_required" || task.status === "failed")
    .map((task) => ({
      id: task.taskId,
      title: `${labelStatus(task.status)} · ${task.categoryName}`,
      description: safeOperationalText(task.lastError, "任务已阻断，需要人工判断是否恢复、换号或暂停。"),
      meta: `${task.storeName || task.storeId} / ${task.assignedAccountId || "未绑定账号"}`,
      tone: task.status === "failed" ? "red" : "amber",
      target: "tasks" as const
    }));
  const workerAlerts = workers
    .filter((row) => row.worker.status !== "online")
    .map((row) => ({
      id: row.worker.workerId,
      title: `设备异常 · ${row.worker.machineLabel}`,
      description: "采集设备不在线或状态异常，任务调度前需要确认设备和网络。",
      meta: row.worker.workerId,
      tone: "amber",
      target: "workers" as const
    }));
  return [...riskAlerts, ...taskAlerts, ...workerAlerts];
}

function buildLiveFeed({ workers, risks, tasks, artifacts, runs, activities }: { workers: WorkerStatusRow[]; risks: RiskEventRecord[]; tasks: CategoryTaskRecord[]; artifacts: ArtifactRecord[]; runs: StoreRunRecord[]; activities: BusinessActivityRecord[] }) {
  const rows = [
    ...activities.map((activity) => ({
      id: `activity-${activity.activityId}`,
      at: activity.occurredAt,
      tone: activity.tone === "success" ? "green" : activity.tone === "danger" ? "red" : activity.tone === "warning" ? "amber" : "blue",
      text: `${activity.storeName}${activity.categoryName ? ` / ${activity.categoryName}` : ""} · ${activity.message}`
    })),
    ...workers.map((row) => ({
      id: `worker-${row.worker.workerId}`,
      at: row.worker.lastSeenAt,
      tone: row.worker.status === "online" ? "green" : "red",
      text: row.worker.latestLogSummary
        ? `${row.worker.machineLabel} · ${row.worker.latestLogSummary}`
        : `${row.worker.machineLabel} 心跳更新，当前状态：${labelStatus(row.worker.status)}`
    })),
    ...risks.map((risk) => ({
      id: `risk-${risk.riskId}`,
      at: risk.createdAt,
      tone: risk.status === "resolved" ? "green" : "red",
      text: `风险事件：${labelStatus(risk.riskType)}，${risk.accountId || risk.workerId} / ${risk.categoryName || "未知类目"}`
    })),
    ...tasks.map((task) => ({
      id: `task-${task.taskId}`,
      at: task.updatedAt,
      tone: isCompletedTask(task.status) ? "green" : isBlockedTask(task.status) ? "red" : "blue",
      text: `${task.storeName || task.storeId} / ${task.categoryName} · ${task.assignedWorkerId || "待分配设备"} · ${labelStatus(task.status)} · 已采 ${task.collectedItems || 0} 件商品`
    })),
    ...artifacts.map((artifact) => ({
      id: `artifact-${artifact.artifactId}`,
      at: artifact.createdAt,
      tone: "green",
      text: `${artifact.storeId || "门店"} · ${artifactDisplayName(artifact.kind)}已安全归档`
    })),
    ...runs.map((run) => ({
      id: `run-${run.runId}`,
      at: run.updatedAt,
      tone: "blue",
      text: `采集批次「${run.runLabel}」状态：${labelStatus(run.status)}`
    }))
  ];
  return rows
    .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
    .slice(0, 40)
    .map((row) => ({ ...row, time: formatTime(row.at) }));
}

export function isCompletedTask(status: string) {
  return status === "completed_valid";
}

export function isRunningTask(status: string) {
  return ["assigned", "running", "collecting", "captured", "uploading", "structuring", "validating"].includes(status);
}

export function isBlockedTask(status: string) {
  return ["manual_required", "needs_review", "failed"].includes(status);
}

function formatTime(value: string) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function latestDate(values: string[]) {
  const timestamps = values.map((value) => new Date(value || 0).getTime()).filter((value) => Number.isFinite(value) && value > 0);
  if (!timestamps.length) return "";
  return new Date(Math.max(...timestamps)).toISOString();
}
