import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  HardDriveUpload,
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
  CategoryTaskRecord,
  RiskEventRecord,
  StoreRecord,
  StoreRunRecord,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import { formatNumber, labelConnection, labelStatus } from "./display.js";

interface Props {
  workers: WorkerStatusRow[];
  accounts: AccountRegistryRow[];
  risks: RiskEventRecord[];
  stores: StoreRecord[];
  runs: StoreRunRecord[];
  tasks: CategoryTaskRecord[];
  artifacts: ArtifactRecord[];
  connection: string;
  onNavigate: (view: "risks" | "stores" | "tasks" | "workers" | "artifacts") => void;
}

export function CommandCenter({ workers, accounts, risks, stores, runs, tasks, artifacts, connection, onNavigate }: Props) {
  const activeWorkers = workers.filter((row) => row.worker.status === "online").length;
  const offlineWorkers = workers.filter((row) => row.worker.status !== "online").length;
  const riskAccounts = accounts.filter((account) => account.status !== "safe" || account.riskLevel !== "normal").length;
  const healthyAccountRatio = accounts.length ? Math.round(((accounts.length - riskAccounts) / accounts.length) * 100) : 100;
  const completedStores = countCompletedStores(stores, tasks);
  const runningStores = countRunningStores(stores, tasks);
  const skuCount = tasks.reduce((sum, task) => sum + Number(task.collectedItems || 0), 0);
  const alerts = buildAlerts(risks, tasks, workers);
  const progressRows = buildStoreProgress(stores, tasks);
  const feed = buildLiveFeed({ workers, risks, tasks, artifacts, runs });
  const manualBlockedTasks = tasks.filter((task) => task.status === "manual_required" || task.status === "failed").length;
  const openRisks = risks.filter((risk) => risk.status !== "resolved").length;
  const uploadedRawArtifacts = artifacts.filter((artifact) => artifact.kind === "raw_jsonl").length;
  const latestHeartbeatAt = latestDate(workers.map((row) => row.worker.lastSeenAt));
  const workerPreviewRows = buildWorkerPreview(workers);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950 px-8 py-7 text-white shadow-glow">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/70 to-transparent" />
        <div className="relative flex items-start justify-between gap-8">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-blue-100">
              <Radio className="h-4 w-4" />
              Retail-Radar 实时采集指挥台
            </div>
            <h1 className="m-0 max-w-4xl text-4xl font-semibold tracking-normal">
              即时零售竞对价格监控与调度中台
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">今日重点：门店全量采集进度、账号风险、Worker 心跳和数据产物统一看板。</p>
            <div className="mt-5 grid max-w-3xl grid-cols-3 gap-3">
              <HeroMeta label="最近心跳" value={latestHeartbeatAt ? formatTime(latestHeartbeatAt) : "--:--"} />
              <HeroMeta label="阻断任务" value={`${manualBlockedTasks} 个`} tone={manualBlockedTasks ? "red" : "green"} />
              <HeroMeta label="RAW 产物" value={`${uploadedRawArtifacts} 个`} />
            </div>
          </div>
          <div className="min-w-48 rounded-lg border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              {connection === "live" ? <Wifi className="h-4 w-4 text-emerald-300" /> : <WifiOff className="h-4 w-4 text-amber-300" />}
              实时连接
            </div>
            <div className="mt-2 text-2xl font-semibold">{labelConnection(connection)}</div>
            <div className="mt-2 text-xs text-slate-400">Master API / WebSocket / Worker 心跳</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-4 gap-4">
        <KpiCard
          icon={<Store className="h-5 w-5" />}
          label="今日目标门店"
          value={`${completedStores}/${stores.length || 0}`}
          hint={`进行中 ${runningStores} 个`}
          tone="blue"
        />
        <KpiCard
          icon={<Monitor className="h-5 w-5" />}
          label="Worker 设备"
          value={`${activeWorkers}/${workers.length || 0}`}
          hint={`空闲/离线 ${offlineWorkers} 个`}
          tone={offlineWorkers ? "amber" : "green"}
        />
        <KpiCard
          icon={<ShieldCheck className="h-5 w-5" />}
          label="健康账号池"
          value={`${healthyAccountRatio}%`}
          hint={`风险账号 ${riskAccounts} 个`}
          tone={riskAccounts ? "red" : "green"}
        />
        <KpiCard
          icon={<Database className="h-5 w-5" />}
          label="今日有效 SKU"
          value={formatNumber(skuCount)}
          hint={`原始产物 ${artifacts.length} 个`}
          tone="indigo"
        />
      </section>

      <section className="grid grid-cols-4 gap-4">
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
          detail="基于 worker 心跳判断"
          tone={offlineWorkers ? "amber" : "green"}
          onClick={() => onNavigate("workers")}
        />
        <OpsCell
          icon={<HardDriveUpload className="h-4 w-4" />}
          label="产物链路"
          value={uploadedRawArtifacts ? "已产生 RAW" : "等待上传"}
          detail={`${artifacts.length} 个产物记录`}
          tone={uploadedRawArtifacts ? "green" : "neutral"}
          onClick={() => onNavigate("artifacts")}
        />
      </section>

      <section className="grid grid-cols-[0.95fr_1.45fr] gap-5">
        <div className="glass-panel rounded-lg p-5">
          <PanelHeader
            icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
            title="高优待办警报中心"
            subtitle="优先处理会阻断采集的事件"
            actionLabel="查看全部"
            onAction={() => onNavigate("risks")}
          />
          <div className="mt-4 space-y-3">
            {alerts.length ? (
              alerts.slice(0, 6).map((alert) => (
                <div key={alert.id} className={`rounded-lg border p-4 ${alert.tone === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className={`text-sm font-semibold ${alert.tone === "red" ? "text-red-700" : "text-amber-700"}`}>{alert.title}</div>
                      <div className="mt-1 text-sm text-slate-600">{alert.description}</div>
                      <div className="mt-2 text-xs text-slate-500">{alert.meta}</div>
                    </div>
                    <button
                      className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white"
                      type="button"
                      onClick={() => onNavigate(alert.target)}
                    >
                      去处理 <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="暂无高优风险" description="当前没有需要立即人工介入的验证码、封禁或设备离线事件。" />
            )}
          </div>
        </div>

        <div className="glass-panel rounded-lg p-5">
          <PanelHeader
            icon={<Activity className="h-5 w-5 text-blue-600" />}
            title="今日核心门店采集进度槽"
            subtitle="按门店聚合类目任务状态"
            actionLabel="管理批次"
            onAction={() => onNavigate("stores")}
          />
          <div className="mt-4 space-y-4">
            {progressRows.length ? (
              progressRows.map((row) => (
                <div key={row.storeId} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.done}/{row.total} 类目完成 · {row.running} 采集中 · {row.blocked} 遇阻
                      </div>
                    </div>
                    <div className="text-2xl font-semibold text-slate-900">{row.percent}%</div>
                  </div>
                  <SegmentBar segments={row.segments} />
                </div>
              ))
            ) : (
              <EmptyState title="暂无门店批次" description="先在门店页创建门店、采集批次和类目任务。" />
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-[1.1fr_0.9fr] gap-5">
        <div className="glass-panel rounded-lg p-5">
          <PanelHeader
            icon={<Zap className="h-5 w-5 text-emerald-600" />}
            title="实时数据流"
            subtitle="以业务语言展示 worker、账号、任务和产物动态"
            actionLabel="查看任务"
            onAction={() => onNavigate("tasks")}
          />
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
            <div className="max-h-72 space-y-0 overflow-auto p-3 font-mono text-sm">
              {feed.map((item) => (
                <div key={item.id} className="flex gap-3 border-b border-white/5 px-2 py-2 text-slate-300 last:border-0">
                  <span className={item.tone === "green" ? "text-emerald-300" : item.tone === "red" ? "text-red-300" : "text-blue-300"}>
                    {item.time}
                  </span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-lg p-5">
          <PanelHeader
            icon={<Users className="h-5 w-5 text-indigo-600" />}
            title="Worker 资源预览"
            subtitle="展示设备、账号、Profile/CDP 和当前类目"
            actionLabel="资源拓扑"
            onAction={() => onNavigate("workers")}
          />
          <div className="mt-4 space-y-3">
            {workerPreviewRows.length ? (
              workerPreviewRows.map((row) => (
                <div className="rounded-lg border border-slate-200 bg-white p-3" key={row.workerId}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{row.machineLabel}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{row.workerId} · {row.networkMode}</div>
                    </div>
                    <span className={`pill pill-${row.status}`}>{labelStatus(row.status)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <ResourceChip label="账号" value={`${row.accountCount}`} />
                    <ResourceChip label="风险" value={`${row.riskAccountCount}`} tone={row.riskAccountCount ? "red" : "green"} />
                    <ResourceChip label="CDP" value={row.cdpPorts || "-"} />
                  </div>
                  <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                    {row.currentWork || "当前没有上报采集中的门店/类目"}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="暂无 Worker 心跳" description="Worker 启动后会在这里显示设备、账号和 CDP 绑定关系。" />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroMeta({ label, value, tone = "blue" }: { label: string; value: string; tone?: "blue" | "green" | "red" }) {
  const valueClass = tone === "green" ? "text-emerald-200" : tone === "red" ? "text-red-200" : "text-blue-100";
  return (
    <div className="rounded-lg border border-white/10 bg-white/10 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

function KpiCard({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: "blue" | "indigo" | "green" | "amber" | "red" }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    red: "bg-red-50 text-red-700 ring-red-100"
  }[tone];
  return (
    <div className="glass-panel rounded-lg p-5">
      <div className="flex items-start justify-between">
        <div className={`rounded-lg p-3 ring-1 ${toneClass}`}>{icon}</div>
        <span className="text-xs font-bold text-slate-400">实时</span>
      </div>
      <div className="mt-5 text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-slate-950">{value}</div>
      <div className="mt-2 text-sm text-slate-500">{hint}</div>
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
  const toneClass = {
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    neutral: "border-slate-200 bg-white text-slate-700"
  }[tone];
  return (
    <button className="glass-panel group rounded-lg p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-200" type="button" onClick={onClick}>
      <div className="flex items-center justify-between gap-3">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${toneClass}`}>{icon}</span>
        <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:text-blue-600" />
      </div>
      <div className="mt-3 text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{detail}</div>
    </button>
  );
}

function PanelHeader({ icon, title, subtitle, actionLabel, onAction }: { icon: ReactNode; title: string; subtitle: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-slate-100 p-2.5">{icon}</div>
        <div>
          <h2 className="m-0 text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:border-blue-300 hover:text-blue-700" type="button" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

function SegmentBar({ segments }: { segments: Array<{ status: string; width: number }> }) {
  return (
    <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
      {segments.map((segment, index) => (
        <div
          key={`${segment.status}-${index}`}
          className={
            segment.status === "completed"
              ? "bg-emerald-500"
              : segment.status === "running"
                ? "bg-blue-500"
                : segment.status === "manual_required" || segment.status === "failed"
                  ? "bg-red-500"
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
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-800";
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`mt-0.5 truncate font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-6 text-center">
      <CheckCircle2 className="mx-auto h-8 w-8 text-slate-300" />
      <div className="mt-2 text-sm font-semibold text-slate-700">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </div>
  );
}

function countCompletedStores(stores: StoreRecord[], tasks: CategoryTaskRecord[]) {
  return stores.filter((store) => {
    const rows = tasks.filter((task) => task.storeId === store.storeId);
    return rows.length > 0 && rows.every((task) => task.status === "completed");
  }).length;
}

function countRunningStores(stores: StoreRecord[], tasks: CategoryTaskRecord[]) {
  return stores.filter((store) => tasks.some((task) => task.storeId === store.storeId && ["running", "assigned", "manual_required"].includes(task.status))).length;
}

function buildStoreProgress(stores: StoreRecord[], tasks: CategoryTaskRecord[]) {
  return stores.map((store) => {
    const rows = tasks.filter((task) => task.storeId === store.storeId);
    const total = rows.length || 1;
    const done = rows.filter((task) => task.status === "completed").length;
    const running = rows.filter((task) => task.status === "running" || task.status === "assigned").length;
    const blocked = rows.filter((task) => task.status === "manual_required" || task.status === "failed").length;
    return {
      storeId: store.storeId,
      name: store.name,
      total: rows.length,
      done,
      running,
      blocked,
      percent: rows.length ? Math.round((done / rows.length) * 100) : 0,
      segments: rows.length
        ? rows.map((task) => ({ status: task.status, width: 100 / rows.length }))
        : [{ status: "pending", width: 100 }]
    };
  });
}

function buildWorkerPreview(workers: WorkerStatusRow[]) {
  return workers.slice(0, 4).map((row) => {
    const riskAccounts = row.accounts.filter((account) => account.status !== "safe" || account.riskLevel !== "normal");
    const workingAccounts = row.accounts.filter((account) => account.currentStoreName || account.currentCategoryName);
    const primaryWork = workingAccounts[0];
    return {
      workerId: row.worker.workerId,
      machineLabel: row.worker.machineLabel,
      status: row.worker.status,
      networkMode: row.worker.networkMode,
      accountCount: row.accounts.length,
      riskAccountCount: riskAccounts.length,
      cdpPorts: row.accounts.map((account) => account.cdpPort).filter(Boolean).join(", "),
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
      description: risk.observed,
      meta: `${risk.storeName || risk.storeId || "未知门店"} / ${risk.categoryName || "未知类目"}`,
      tone: risk.severity === "critical" || risk.severity === "high" ? "red" : "amber",
      target: "risks" as const
    }));
  const taskAlerts = tasks
    .filter((task) => task.status === "manual_required" || task.status === "failed")
    .map((task) => ({
      id: task.taskId,
      title: `${labelStatus(task.status)} · ${task.categoryName}`,
      description: task.lastError || "任务已阻断，需要人工判断是否恢复、换号或暂停。",
      meta: `${task.storeName || task.storeId} / ${task.assignedAccountId || "未绑定账号"}`,
      tone: task.status === "failed" ? "red" : "amber",
      target: "tasks" as const
    }));
  const workerAlerts = workers
    .filter((row) => row.worker.status !== "online")
    .map((row) => ({
      id: row.worker.workerId,
      title: `设备异常 · ${row.worker.machineLabel}`,
      description: "Worker 不在线或状态异常，任务调度前需要确认设备和网络。",
      meta: row.worker.workerId,
      tone: "amber",
      target: "workers" as const
    }));
  return [...riskAlerts, ...taskAlerts, ...workerAlerts];
}

function buildLiveFeed({ workers, risks, tasks, artifacts, runs }: { workers: WorkerStatusRow[]; risks: RiskEventRecord[]; tasks: CategoryTaskRecord[]; artifacts: ArtifactRecord[]; runs: StoreRunRecord[] }) {
  const rows = [
    ...workers.map((row) => ({
      id: `worker-${row.worker.workerId}`,
      at: row.worker.lastSeenAt,
      tone: row.worker.status === "online" ? "green" : "red",
      text: `${row.worker.machineLabel} 心跳更新，当前状态：${labelStatus(row.worker.status)}`
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
      tone: task.status === "completed" ? "green" : task.status === "manual_required" || task.status === "failed" ? "red" : "blue",
      text: `${task.assignedWorkerId || "未分配设备"} 处理「${task.categoryName}」，状态：${labelStatus(task.status)}，已采 ${task.collectedItems || 0} SKU`
    })),
    ...artifacts.map((artifact) => ({
      id: `artifact-${artifact.artifactId}`,
      at: artifact.createdAt,
      tone: "green",
      text: `原始产物已归档：${labelStatus(artifact.kind)} / ${artifact.objectKey}`
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
    .slice(0, 18)
    .map((row) => ({ ...row, time: formatTime(row.at) }));
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
