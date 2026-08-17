import { Activity, Clock3, Layers3, Store } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { CategoryTaskRecord, StoreRunRecord } from "@retail-orchestrator/shared";
import { formatNumber, labelStatus, StatusPill } from "./display.js";
import { safeOperationalText } from "./safe-display.js";
import { buildTruthfulRunProgress } from "./truth-metrics.js";

export function StoreRunBoard({
  runs,
  tasks,
  onOpenStores
}: {
  runs: StoreRunRecord[];
  tasks: CategoryTaskRecord[];
  onOpenStores: () => void;
}) {
  const activeRuns = runs.filter((run) => run.status !== "cancelled");
  const activeRunIds = new Set(activeRuns.map((run) => run.runId));
  const activeTasks = tasks.filter((task) => activeRunIds.has(task.runId));
  const summary = buildSummary(activeRuns, activeTasks);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());

  function toggleRun(runId: string) {
    setExpandedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-base md:text-lg font-bold text-slate-900 tracking-tight">门店采集实时运行总览</div>
          <div className="mt-1 text-xs font-medium text-slate-500 max-w-2xl leading-relaxed">按门店和批次汇总类目进度，及时发现阻断、账号异常和席位分配问题。</div>
        </div>
        <button className="action-button px-4 py-2 text-xs font-semibold self-start sm:self-center shrink-0 shadow-sm" type="button" onClick={onOpenStores}>
          管理门店与采集批次
        </button>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <BoardMetric
          icon={<Store className="h-5 w-5" />}
          label="目标采集批次"
          value={`${summary.totalRuns}`}
          detail={`运行中 ${summary.runningRuns} 个`}
          tone="blue"
        />
        <BoardMetric
          icon={<Layers3 className="h-5 w-5" />}
          label="类目切片总量"
          value={`${summary.totalTasks}`}
          detail={`已完成 ${summary.completedTasks} 个`}
          tone="green"
        />
        <BoardMetric
          icon={<Activity className="h-5 w-5" />}
          label="已验证类目进度"
          value={summary.progressLabel}
          detail={summary.progressDetail}
          tone="indigo"
        />
        <BoardMetric
          icon={<Clock3 className="h-5 w-5" />}
          label="关注阻断任务"
          value={`${summary.blockedTasks}`}
          detail={summary.blockedTasks ? "存在人工干预或报错" : "各批次平稳推进中"}
          tone={summary.blockedTasks ? "amber" : "blue"}
        />
      </section>

      {activeRuns.length ? (
        <section className="store-run-grid">
          {activeRuns.map((run) => {
            const runTasks = tasks
              .filter((task) => task.runId === run.runId)
              .sort((left, right) => left.categoryOrder - right.categoryOrder || left.priority - right.priority);
            const progress = buildRunProgress(runTasks);
            const expanded = expandedRunIds.has(run.runId);
            const visibleTasks = expanded ? runTasks : selectTaskPreview(runTasks, 8);
            return (
              <article className="glass-panel rounded-2xl p-5 md:p-6 transition-all hover:border-slate-300 shadow-sm" key={run.runId}>
                <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="m-0 text-lg font-bold text-slate-900 tracking-tight">{run.storeName || run.storeId}</h2>
                      <StatusPill status={run.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                      <span className="font-semibold text-slate-700">{run.runLabel}</span>
                      <span>·</span>
                      <span>策略：{renderStrategy(run.strategy)}</span>
                      <span>·</span>
                      <span>最后同步：{formatTime(run.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="self-start sm:self-center rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2 text-left sm:text-right shrink-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">批次完成度</div>
                    <div className="mt-0.5 text-lg font-extrabold text-slate-900">{progress.progressLabel}</div>
                  </div>
                </header>

                <div className="mt-5 overflow-hidden rounded-full bg-slate-100 border border-slate-200/50 h-2.5">
                  <div className="store-run-progress-bar transition-all duration-300" style={{ width: `${progress.progressBarPercent}%` }} />
                </div>
                <div className="mt-2 text-xs font-medium text-slate-500 leading-relaxed">{progress.progressDetail}</div>

                <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MiniStat label="类目完成" value={`${progress.completedTasks}/${progress.totalTasks || 0}`} />
                  <MiniStat label="正在运行" value={`${progress.activeTasks}`} />
                  <MiniStat label="遇到阻断" value={`${progress.blockedTasks}`} tone={progress.blockedTasks ? "red" : "neutral"} />
                  <MiniStat label="商品采集" value={progress.collectionLabel} />
                </div>

                <div className="mt-5 space-y-3 pt-2 border-t border-slate-200/60">
                  {runTasks.length ? (
                    visibleTasks.map((task) => (
                      <section className="store-task-card rounded-xl transition hover:border-slate-300" key={task.taskId}>
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-bold text-slate-900">{task.categoryName}</div>
                              <StatusPill status={task.status} className="!text-[10px] !py-0.5" />
                            </div>
                            <div className="mt-1 text-xs font-medium text-slate-400">
                              切片序号 #{task.categoryOrder} · 调度优先级 #{task.priority} · 更新于 {formatTime(task.updatedAt)}
                            </div>
                          </div>
                          <div className="self-start sm:self-center text-left sm:text-right text-sm font-bold text-slate-900">
                            <span>{renderTaskCollectionPrimary(task)}</span>
                            <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                              {renderTaskCollectionSecondary(task)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                          <MetaCell label="绑定账号" value={task.assignedAccountId ? compressId(task.assignedAccountId) : "暂未绑定"} />
                          <MetaCell label="浏览器席位" value={task.assignedCdpEndpointId ? compressId(task.assignedCdpEndpointId) : "自动调配"} />
                          <MetaCell label="采集设备" value={task.assignedWorkerId ? compressId(task.assignedWorkerId) : "等待分配"} />
                        </div>

                        {task.lastError ? (
                          <div className="mt-3 rounded-lg border border-rose-200/80 bg-rose-50/60 px-3 py-2 text-xs font-medium text-rose-800 leading-relaxed">
                            {safeOperationalText(task.lastError)}
                          </div>
                        ) : null}
                      </section>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-xs font-medium text-slate-400">
                      当前批次尚未生成具体类目切片任务。
                    </div>
                  )}
                  {runTasks.length > visibleTasks.length || expanded ? (
                    <button className="run-task-toggle" type="button" onClick={() => toggleRun(run.runId)}>
                      {expanded ? "收起类目明细" : `查看全部 ${runTasks.length} 个类目`}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="glass-panel rounded-2xl px-6 py-12 text-center">
          <Store className="mx-auto h-12 w-12 text-slate-300" />
          <div className="mt-4 text-base font-bold text-slate-900">暂无正在运行的门店采集批次</div>
          <div className="mt-1.5 text-xs font-medium text-slate-500 max-w-md mx-auto">请在上方点击“管理门店与采集批次”创建门店并下发采集计划任务，系统将在此即时渲染类目切片执行大图。</div>
        </section>
      )}
    </div>
  );
}

function selectTaskPreview(tasks: CategoryTaskRecord[], limit: number): CategoryTaskRecord[] {
  const attention = tasks.filter((task) => isTaskBlocked(task.status) || isTaskActive(task.status));
  const attentionIds = new Set(attention.map((task) => task.taskId));
  const remaining = tasks.filter((task) => !attentionIds.has(task.taskId));
  return [...attention, ...remaining].slice(0, limit);
}

function BoardMetric({
  icon,
  label,
  value,
  detail,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "green" | "indigo" | "amber";
}) {
  const iconClass = {
    blue: "bg-slate-100 text-slate-800 border-slate-200/80",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    indigo: "bg-slate-100 text-slate-800 border-slate-200/80",
    amber: "bg-amber-50 text-amber-700 border-amber-200/60"
  }[tone];
  return (
    <div className="glass-panel rounded-2xl p-5 md:p-6 transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex rounded-xl p-3 border ${iconClass}`}>{icon}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          门店维度
        </span>
      </div>
      <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1.5 text-3xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-2 text-xs font-medium text-slate-500">{detail}</div>
    </div>
  );
}

function MiniStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "red" }) {
  return (
    <div className={`store-run-mini-stat ${tone === "red" ? "store-run-mini-stat-danger" : ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{label}</div>
      <div className="mt-1 text-sm font-bold text-slate-900 truncate">{value}</div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="store-run-meta-cell">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-xs font-bold text-slate-800" title={value}>{value}</div>
    </div>
  );
}

function buildSummary(runs: StoreRunRecord[], tasks: CategoryTaskRecord[]) {
  const truth = buildTruthfulRunProgress(tasks);
  const completedTasks = truth.resolvedCategories;
  return {
    totalRuns: runs.length,
    runningRuns: runs.filter((run) => run.status === "running").length,
    totalTasks: tasks.length,
    completedTasks,
    blockedTasks: tasks.filter((task) => isTaskBlocked(task.status)).length,
    progressLabel: `${truth.categoryCompletionPercent}%`,
    progressDetail: `商品类目已校验 ${truth.validatedCategories} · 非商品入口 ${truth.excludedCategories} · 已采商品记录 ${formatNumber(truth.collectedItems)} · ${truth.itemProgressLabel}`
  };
}

function buildRunProgress(tasks: CategoryTaskRecord[]) {
  const truth = buildTruthfulRunProgress(tasks);
  const completedTasks = truth.resolvedCategories;
  return {
    totalTasks: tasks.length,
    completedTasks,
    activeTasks: tasks.filter((task) => isTaskActive(task.status)).length,
    blockedTasks: tasks.filter((task) => isTaskBlocked(task.status)).length,
    progressBarPercent: truth.categoryCompletionPercent,
    progressLabel: `${truth.categoryCompletionPercent}%`,
    progressDetail: `商品类目已校验 ${truth.validatedCategories} · 非商品入口 ${truth.excludedCategories} · 已采商品记录 ${formatNumber(truth.collectedItems)} · ${truth.itemProgressLabel}`,
    collectionLabel: truth.expectedItemsKnown
      ? `${formatNumber(truth.collectedItems)}/${formatNumber(truth.expectedItems || 0)}`
      : `${formatNumber(truth.collectedItems)} / 总量待识别`
  };
}

function renderTaskCollectionPrimary(task: CategoryTaskRecord) {
  return task.expectedItems ? `${formatNumber(task.collectedItems)} / ${formatNumber(task.expectedItems)}` : `已采集 ${formatNumber(task.collectedItems)}`;
}

function renderTaskCollectionSecondary(task: CategoryTaskRecord) {
  return task.expectedItems ? "商品进度" : "预估未知";
}

function formatTime(value?: string) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function renderStrategy(strategy: StoreRunRecord["strategy"]) {
  return strategy === "account_rotation" ? "账号轮换" : "类目拆分";
}

function isTaskCompleted(status: string): boolean {
  return status === "completed_valid";
}

function isTaskActive(status: string): boolean {
  return ["assigned", "running", "collecting", "captured", "uploading", "structuring", "validating"].includes(status);
}

function isTaskBlocked(status: string): boolean {
  return ["manual_required", "needs_review", "failed"].includes(status);
}

function compressId(value: string) {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
