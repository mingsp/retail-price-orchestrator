import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileWarning,
  ExternalLink,
  PauseCircle,
  Monitor,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  UserRoundX
} from "lucide-react";
import type { BrowserSlotRecord, CategoryTaskRecord, RiskClusterRecord, RiskEventRecord, TaskOperatorAction, WorkerStatusRow } from "@retail-orchestrator/shared";
import { labelStatus, StatusPill } from "./display.js";
import { safeOperationalText } from "./safe-display.js";
import { remoteDesktopHref } from "./resource-matrix.js";
import { fetchArtifactContent } from "./api.js";

interface Props {
  risks: RiskEventRecord[];
  riskClusters: RiskClusterRecord[];
  tasks: CategoryTaskRecord[];
  workers: WorkerStatusRow[];
  slots: BrowserSlotRecord[];
  onRiskAction: (riskId: string, status: RiskEventRecord["status"]) => void;
  onTaskAction: (taskId: string, action: TaskOperatorAction) => void;
  onTaskMigrate: (taskId: string, targetSlotId: string) => void;
}

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

export function RiskInterventionStation({ risks, riskClusters, tasks, workers, slots, onRiskAction, onTaskAction, onTaskMigrate }: Props) {
  const sortedRisks = useMemo(() => sortRisks(risks), [risks]);
  const activeClusters = useMemo(() => riskClusters.filter((cluster) => cluster.status !== "resolved"), [riskClusters]);
  const [selectedId, setSelectedId] = useState("");
  const selected = sortedRisks.find((risk) => risk.riskId === selectedId) || sortedRisks.find((risk) => risk.status !== "resolved") || sortedRisks[0];
  const openCount = risks.filter((risk) => risk.status === "open").length;
  const criticalCount = risks.filter((risk) => risk.status !== "resolved" && (risk.severity === "critical" || risk.severity === "high")).length;
  const resolvedCount = risks.filter((risk) => risk.status === "resolved").length;

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <RiskStat icon={<ShieldAlert className="h-5 w-5" />} label="待处理风险事件" value={`${openCount}`} tone={openCount ? "red" : "green"} />
        <RiskStat icon={<AlertTriangle className="h-5 w-5" />} label="高危/严重阻断" value={`${criticalCount}`} tone={criticalCount ? "red" : "green"} />
        <RiskStat icon={<CheckCircle2 className="h-5 w-5" />} label="已人工复核解决" value={`${resolvedCount}`} tone="green" />
        <RiskStat icon={<Clock3 className="h-5 w-5" />} label="系统监测总量" value={`${risks.length}`} tone="blue" />
      </section>

      <section className="glass-panel rounded-2xl p-5 md:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
          <div>
            <h2 className="m-0 text-base md:text-lg font-bold text-slate-900 tracking-tight">跨账号风控智能聚类分析</h2>
            <p className="mt-1 text-xs font-medium text-slate-500 leading-relaxed">同门店/同类目/同风险类型自动收敛聚合，用于识别类目入口级批量风控并避免持续消耗备用账号。</p>
          </div>
          <StatusPill status={activeClusters.length ? "high" : "resolved"} />
        </div>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {activeClusters.length ? (
            activeClusters.slice(0, 6).map((cluster) => (
              <RiskClusterCard cluster={cluster} key={cluster.clusterId} />
            ))
          ) : (
            <div className="col-span-full rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-xs font-medium text-slate-400">
              当前无跨账号共性风险，各采集设备运行状态平稳。
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-[380px_1fr] xl:grid-cols-[420px_1fr] gap-6 items-start">
        <aside className="glass-panel rounded-2xl p-5 md:p-6">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 pb-4">
            <div>
              <h2 className="m-0 text-base font-bold text-slate-900 tracking-tight">实时事件处理队列</h2>
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">按严重程度与时效动态排序</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200/80 px-2.5 py-1 text-xs font-bold text-rose-700">
              {openCount} 待复核
            </span>
          </div>

          <div className="mt-4 max-h-[700px] space-y-2.5 overflow-y-auto pr-1">
            {sortedRisks.length ? (
              sortedRisks.map((risk) => (
                <button
                  className={`w-full rounded-xl border p-4 text-left transition-all ${
                    selected?.riskId === risk.riskId
                      ? "border-slate-800 bg-slate-900 text-white shadow-md"
                      : risk.status === "resolved"
                        ? "border-slate-200/80 bg-white hover:border-slate-300"
                        : "border-amber-200/80 bg-amber-50/60 hover:border-amber-300"
                  }`}
                  key={risk.riskId}
                  type="button"
                  onClick={() => setSelectedId(risk.riskId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill status={risk.severity} className="!text-[10px] !py-0.5" />
                        <StatusPill status={risk.riskType} className="!text-[10px] !py-0.5" />
                        <StatusPill status={risk.status} className="!text-[10px] !py-0.5" />
                      </div>
                      <div className={`mt-2.5 truncate text-sm font-bold ${selected?.riskId === risk.riskId ? "text-white" : "text-slate-900"}`}>{risk.accountId || risk.workerId}</div>
                      <div className={`mt-1 truncate text-xs ${selected?.riskId === risk.riskId ? "text-slate-300" : "text-slate-500 font-medium"}`}>{risk.storeName || risk.storeId || "未知门店"} / {risk.categoryName || "未知类目"}</div>
                    </div>
                    <div className={`shrink-0 text-[11px] font-semibold ${selected?.riskId === risk.riskId ? "text-slate-400" : "text-slate-400"}`}>{formatTime(risk.createdAt)}</div>
                  </div>
                  <div className={`mt-2.5 line-clamp-2 text-xs leading-relaxed font-normal ${selected?.riskId === risk.riskId ? "text-slate-300" : "text-slate-600"}`}>{safeOperationalText(risk.observed)}</div>
                </button>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-xs font-medium text-slate-400">当前没有待介入的风险事件</div>
            )}
          </div>
        </aside>

        <main className="glass-panel rounded-2xl p-5 md:p-6 min-w-0">
          {selected ? (
            <RiskActionPanel risk={selected} tasks={tasks} workers={workers} slots={slots} onRiskAction={onRiskAction} onTaskAction={onTaskAction} onTaskMigrate={onTaskMigrate} />
          ) : (
            <div className="flex min-h-[560px] flex-col items-center justify-center text-center p-8">
              <CheckCircle2 className="h-14 w-14 text-emerald-400 animate-pulse" />
              <div className="mt-4 text-lg font-bold text-slate-900 tracking-tight">所有异常事件已完成介入处置</div>
              <div className="mt-1.5 text-xs font-medium text-slate-500 max-w-sm">出现验证码、账号异常或渠道拒绝访问时，系统会在这里展示现场和处理建议。</div>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function RiskClusterCard({ cluster }: { cluster: RiskClusterRecord }) {
  const tone = cluster.status === "quarantine" ? "border-rose-200/90 bg-rose-50/40" : "border-amber-200/90 bg-amber-50/40";
  return (
    <div className={`rounded-xl border p-4 transition hover:shadow-sm ${tone}`}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={cluster.severity} />
            <StatusPill status={cluster.status === "quarantine" ? "failed" : "running"} />
          </div>
          <div className="mt-2.5 truncate text-sm font-bold text-slate-900" title={`${cluster.storeName || cluster.storeId || "未知门店"} / ${cluster.categoryName || "未知类目"}`}>
            {cluster.storeName || cluster.storeId || "未知门店"} / {cluster.categoryName || "未知类目"}
          </div>
          <div className="mt-1 text-xs font-medium text-slate-500">
            {cluster.eventCount} 次复现 · {cluster.affectedAccountCount} 个关联账号 · {cluster.openEventCount} 待解除
          </div>
        </div>
        <StatusPill status={cluster.riskType} />
      </div>
      <p className="mb-0 mt-3 line-clamp-2 text-xs leading-relaxed text-slate-600 font-normal">{cluster.recommendation}</p>
      <div className="mt-3 truncate text-[11px] font-medium text-slate-400 pt-2 border-t border-slate-200/50" title={cluster.affectedAccounts.join(" / ")}>
        受影响账号：{cluster.affectedAccounts.join(" / ") || "-"}
      </div>
    </div>
  );
}

function RiskActionPanel({
  risk,
  tasks,
  workers,
  slots,
  onRiskAction,
  onTaskAction,
  onTaskMigrate
}: {
  risk: RiskEventRecord;
  tasks: CategoryTaskRecord[];
  workers: WorkerStatusRow[];
  slots: BrowserSlotRecord[];
  onRiskAction: Props["onRiskAction"];
  onTaskAction: Props["onTaskAction"];
  onTaskMigrate: Props["onTaskMigrate"];
}) {
  const resolved = risk.status === "resolved";
  const taskResolution = resolveRiskTask(risk, tasks);
  const task = taskResolution.taskId ? tasks.find((item) => item.taskId === taskResolution.taskId) : undefined;
  const worker = workers.find((item) => item.worker.workerId === risk.workerId);
  const riskSlot = slots.find((item) => item.workerId === risk.workerId && (
    item.profileId === risk.profileId || item.port === risk.cdpPort
  ));
  const remote = worker?.worker.remoteDesktop;
  const remoteHref = remote?.status === "ready"
    ? remoteDesktopHref(remote.provider, riskSlot?.remoteDesktopTarget || remote.target)
    : undefined;
  const migrationSlots = slots.filter((item) =>
    item.slotId !== riskSlot?.slotId &&
    item.targetStoreId === (task?.storeId || risk.storeId) &&
    ["idle", "ready"].includes(item.status) &&
    item.accountId && item.profileId
  );
  const [targetSlotId, setTargetSlotId] = useState("");
  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={risk.severity} />
            <StatusPill status={risk.riskType} />
            <StatusPill status={risk.status} />
          </div>
          <h2 className="m-0 mt-3 text-xl font-extrabold text-slate-900 tracking-tight">{risk.accountId || risk.workerId}</h2>
          <div className="mt-1 text-xs font-medium text-slate-500">{risk.storeName || risk.storeId || "未知门店"} / {risk.categoryName || "未知类目"}</div>
        </div>
        <div className="self-start sm:self-center text-left sm:text-right text-xs text-slate-400">
          <div className="font-semibold uppercase tracking-wider text-[10px]">捕获发生时间</div>
          <div className="mt-1 font-bold text-slate-800 font-mono text-xs">{formatDateTime(risk.createdAt)}</div>
        </div>
      </header>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
              <Monitor className="h-4 w-4 text-blue-600" />
              <span>现场快照还原</span>
            </div>
            {risk.screenshotArtifactId ? (
              <SecureArtifactImage artifactId={risk.screenshotArtifactId} />
            ) : (
              <div className="mt-3.5 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <FileWarning className="mx-auto h-10 w-10 text-slate-300" />
                <div className="mt-3 text-xs font-bold text-slate-700">本次事件没有可用现场截图</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-400 max-w-sm mx-auto font-normal">可通过远程处理入口查看当前页面，后续风险事件会自动尝试归档截图。</div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700">异常现象观测摘要</div>
            <p className="mb-0 mt-2.5 whitespace-pre-wrap text-xs leading-relaxed text-slate-600 font-normal">{safeOperationalText(risk.observed)}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700">基础定位元信息</div>
            <div className="mt-3.5 grid grid-cols-2 gap-2 text-xs">
              <ContextTile label="采集设备" value={risk.workerId} />
              <ContextTile label="所属账号" value={risk.accountId || "-"} />
              <ContextTile label="浏览器席位" value={risk.profileId || "-"} />
              <ContextTile label="席位端口" value={risk.cdpPort ? `${risk.cdpPort}` : "-"} />
              <ContextTile label="报错阶段" value={risk.phase || "-"} />
              <ContextTile label="事件标识 ID" value={risk.riskId} />
            </div>
          </div>

          <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800">智能中台调度建议</div>
            <p className="mb-0 mt-2 whitespace-pre-wrap text-xs leading-relaxed text-amber-800 font-medium">{safeOperationalText(risk.recommendedAction, "请人工评估：选择恢复、更换备用账号、停用浏览器席位或暂停当前类目任务 2 小时。")}</p>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-700">安全应急处置操作</div>
            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
              <a
                className={`action-button rounded-xl font-semibold ${remoteHref ? "" : "pointer-events-none opacity-45"}`}
                href={remoteHref}
                title={remoteHref ? "打开该设备处理当前页面" : "该设备尚未提供可用的远程处理入口"}
              >
                <ExternalLink className="h-4 w-4 text-blue-600" />
                <span>远程处理页面</span>
              </a>
              <button className="action-button rounded-xl font-semibold" disabled={resolved} type="button" onClick={() => onRiskAction(risk.riskId, "acknowledged")}>
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                <span>确认接手复核</span>
              </button>
              <button className="action-button rounded-xl font-semibold" disabled={resolved} type="button" onClick={() => onRiskAction(risk.riskId, "resolved")}>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>标记彻底解决</span>
              </button>
              <button
                className="action-button rounded-xl font-semibold"
                disabled={resolved || !taskResolution.taskId}
                title={resolved ? "风险已解决" : taskResolution.reason}
                type="button"
                onClick={() => taskResolution.taskId && onTaskAction(taskResolution.taskId, "resume")}
              >
                <RotateCcw className="h-4 w-4 text-blue-600" />
                <span>立即恢复任务</span>
              </button>
              <button
                className="action-button rounded-xl font-semibold"
                disabled={resolved || !taskResolution.taskId}
                title={resolved ? "风险已解决" : taskResolution.reason}
                type="button"
                onClick={() => taskResolution.taskId && onTaskAction(taskResolution.taskId, "sleep_2h")}
              >
                <PauseCircle className="h-4 w-4 text-amber-600" />
                <span>任务休眠 2 小时</span>
              </button>
              <button
                className="action-button rounded-xl font-semibold"
                disabled={resolved || !taskResolution.taskId}
                title={resolved ? "风险已解决" : taskResolution.reason}
                type="button"
                onClick={() => taskResolution.taskId && onTaskAction(taskResolution.taskId, "requeue")}
              >
                <RefreshCw className="h-4 w-4 text-indigo-600" />
                <span>重新加入队列</span>
              </button>
              <button
                className="action-button danger rounded-xl font-semibold"
                disabled={resolved || !taskResolution.taskId}
                title={resolved ? "风险已解决" : taskResolution.reason}
                type="button"
                onClick={() => taskResolution.taskId && onTaskAction(taskResolution.taskId, "mark_manual_required")}
              >
                <UserRoundX className="h-4 w-4" />
                <span>转人工专门阻断</span>
              </button>
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4">
              <div className="text-xs font-bold text-slate-700">从已保存断点切换浏览器席位</div>
              <div className="mt-2 flex gap-2">
                <select className="small-select min-w-0 flex-1" value={targetSlotId} onChange={(event) => setTargetSlotId(event.target.value)}>
                  <option value="">选择健康席位</option>
                  {migrationSlots.map((slot) => <option key={slot.slotId} value={slot.slotId}>{slot.label}</option>)}
                </select>
                <button
                  className="action-button rounded-xl font-semibold"
                  disabled={!task?.checkpointArtifactId || !targetSlotId}
                  title={!task?.checkpointArtifactId ? "当前任务尚无可迁移断点" : "切换后从断点继续"}
                  type="button"
                  onClick={() => task && onTaskMigrate(task.taskId, targetSlotId)}
                >
                  <RotateCcw className="h-4 w-4 text-indigo-600" />
                  <span>切换席位</span>
                </button>
              </div>
            </div>
            <div className="mt-3.5 text-xs leading-relaxed text-slate-500 font-normal pt-2.5 border-t border-slate-100">
              {taskResolution.taskId
                ? `关联任务 ${taskResolution.taskId}。任务调度指令仅改变任务引擎状态，不会直接重置此条风控警报记录。`
                : taskResolution.reason}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SecureArtifactImage({ artifactId }: { artifactId: string }) {
  const [objectUrl, setObjectUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let currentUrl = "";
    setFailed(false);
    setObjectUrl("");
    void fetchArtifactContent(artifactId)
      .then((blob) => {
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [artifactId]);

  if (failed) {
    return <div className="mt-3.5 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-xs font-semibold text-amber-800">现场截图读取失败，请稍后重试或使用远程处理入口。</div>;
  }
  if (!objectUrl) {
    return <div className="mt-3.5 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs font-semibold text-slate-500">正在安全读取现场截图...</div>;
  }
  return (
    <a href={objectUrl} target="_blank" rel="noreferrer" className="mt-3.5 block overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <img className="block max-h-[440px] w-full object-contain" src={objectUrl} alt="异常发生时的浏览器页面截图" />
    </a>
  );
}

function RiskStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "blue" | "green" | "red" }) {
  const iconClass = {
    blue: "bg-slate-100 text-slate-800 border-slate-200/80",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    red: "bg-rose-50 text-rose-700 border-rose-200/60"
  }[tone];
  return (
    <div className="glass-panel rounded-2xl p-5 md:p-6 transition hover:border-slate-300">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${iconClass}`}>{icon}</div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

function ContextTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 truncate font-bold text-xs text-slate-800" title={value}>{value}</div>
    </div>
  );
}

function sortRisks(risks: RiskEventRecord[]) {
  return [...risks].sort((a, b) => {
    const statusA = a.status === "resolved" ? 1 : 0;
    const statusB = b.status === "resolved" ? 1 : 0;
    if (statusA !== statusB) return statusA - statusB;
    const severityA = severityOrder[a.severity] ?? 9;
    const severityB = severityOrder[b.severity] ?? 9;
    if (severityA !== severityB) return severityA - severityB;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function resolveRiskTask(risk: RiskEventRecord, tasks: CategoryTaskRecord[]) {
  const activeTasks = tasks.filter((task) => !["completed", "completed_valid", "skipped"].includes(task.status));
  const withStore = risk.storeId ? activeTasks.filter((task) => task.storeId === risk.storeId) : activeTasks;
  const withCategory = risk.categoryName ? withStore.filter((task) => task.categoryName === risk.categoryName) : withStore;

  const identityMatched = withCategory.filter((task) => matchesRiskIdentity(task, risk));
  const candidates = identityMatched.length ? identityMatched : withCategory;
  const strongMatches = candidates.filter((task) => hasStrongIdentityMatch(task, risk));

  if (strongMatches.length === 1) {
    return { taskId: strongMatches[0].taskId, reason: `已精准定位到关联任务 ${strongMatches[0].taskId}` };
  }
  if (!strongMatches.length && candidates.length === 1 && risk.storeId && risk.categoryName) {
    return { taskId: candidates[0].taskId, reason: `已根据类目定位关联任务 ${candidates[0].taskId}` };
  }
  if (!risk.storeId && !risk.categoryName && !risk.accountId && !risk.profileId && !risk.workerId) {
    return { reason: "关联缺失：风险事件未携带足够的核心任务定位标识。" };
  }
  if (candidates.length > 1 || strongMatches.length > 1) {
    return { reason: "多重关联：当前风险事件同时匹配多个任务切片，已禁用自动调度按钮。" };
  }
  return { reason: "关联缺失：系统无法从当前风险元数据中推断目标任务 ID。" };
}

function matchesRiskIdentity(task: CategoryTaskRecord, risk: RiskEventRecord) {
  if (risk.accountId && task.assignedAccountId && task.assignedAccountId !== risk.accountId) return false;
  if (risk.profileId && task.assignedProfileId && task.assignedProfileId !== risk.profileId) return false;
  if (risk.workerId && task.assignedWorkerId && task.assignedWorkerId !== risk.workerId) return false;
  return true;
}

function hasStrongIdentityMatch(task: CategoryTaskRecord, risk: RiskEventRecord) {
  if (risk.profileId && task.assignedProfileId === risk.profileId) return true;
  if (risk.accountId && task.assignedAccountId === risk.accountId) return true;
  if (risk.workerId && task.assignedWorkerId === risk.workerId && risk.storeId && task.storeId === risk.storeId) return true;
  return false;
}

function formatTime(value: string) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
