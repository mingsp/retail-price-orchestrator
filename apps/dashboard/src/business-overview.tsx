import { AlertTriangle, CheckCircle2, Database, PlayCircle, Store, UsersRound } from "lucide-react";
import type { BusinessOverviewRecord, RunProgressRecord } from "@retail-orchestrator/shared";
import { businessRunStatus, formatBusinessTime } from "./business-display.js";

export function BusinessOverview({
  overview,
  runs,
  onOpenIssues,
  onOpenRuns
}: {
  overview?: BusinessOverviewRecord;
  runs: RunProgressRecord[];
  onOpenIssues: () => void;
  onOpenRuns: () => void;
}) {
  const activeRuns = runs.filter((run) => run.status !== "cancelled").slice(0, 6);
  return (
    <div className="business-page">
      <section className="business-kpi-grid" aria-label="今日采集概览">
        <Metric icon={<Store />} label="今日门店批次" value={overview?.targetRuns ?? "--"} detail={`进行中 ${overview?.activeRuns ?? 0}`} />
        <Metric icon={<CheckCircle2 />} label="今日已完成" value={overview?.completedRuns ?? "--"} detail="通过完整性核对" tone="success" />
        <Metric icon={<UsersRound />} label="可用采集席位" value={overview?.availableCollectionSlots ?? "--"} detail="可继续执行任务" />
        <Metric icon={<Database />} label="今日有效商品" value={formatNumber(overview?.collectedProducts)} detail="按门店商品去重" />
      </section>

      <section className="business-band">
        <header className="business-section-heading">
          <div>
            <h2>门店采集进度</h2>
            <p>完成度仅统计已通过原始数据、结构化和质量核对的类目。</p>
          </div>
          <button className="business-link-button" type="button" onClick={onOpenRuns}>查看全部</button>
        </header>
        <div className="business-run-list">
          {activeRuns.length ? activeRuns.map((run) => <RunRow key={run.runId} run={run} />) : <EmptyState text="暂无采集批次" />}
        </div>
      </section>

      <section className={`business-attention ${overview?.openIssues ? "is-active" : ""}`} aria-live="polite">
        <span className="business-attention-icon">{overview?.openIssues ? <AlertTriangle /> : <PlayCircle />}</span>
        <div className="min-w-0 flex-1">
          <strong>{overview?.openIssues ? `${overview.openIssues} 项采集需要处理` : "当前采集任务平稳运行"}</strong>
          <span>{overview?.openIssues ? "所有已采数据和断点均已保留。" : "系统将持续记录门店、类目和商品完整度。"}</span>
        </div>
        {overview?.openIssues ? <button type="button" onClick={onOpenIssues}>查看待办</button> : null}
      </section>
    </div>
  );
}

export function BusinessRuns({ runs }: { runs: RunProgressRecord[] }) {
  return (
    <div className="business-page">
      <section className="business-band">
        <header className="business-section-heading"><div><h2>门店任务</h2><p>按门店批次核对类目完成度和已采商品数。</p></div></header>
        <div className="business-run-list">
          {runs.length ? runs.map((run) => <RunRow key={run.runId} run={run} expanded />) : <EmptyState text="暂无门店任务" />}
        </div>
      </section>
    </div>
  );
}

function RunRow({ run, expanded = false }: { run: RunProgressRecord; expanded?: boolean }) {
  const percent = run.categoryCompletionPercent;
  const attention = run.attentionCategories > 0;
  return (
    <article className="business-run-row">
      <div className="business-run-main">
        <div className="business-run-titleline">
          <strong>{run.storeName || run.storeId}</strong>
          <span className={`business-status ${attention ? "danger" : run.status === "completed" ? "success" : "active"}`}>{businessRunStatus(run.status)}</span>
        </div>
        <div className="business-run-meta"><span>{run.runLabel}</span><span>更新于 {formatBusinessTime(run.updatedAt)}</span></div>
        <div className="business-progress-track" role="progressbar" aria-label={`${run.storeName || run.storeId} 类目完成度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="business-run-summary">
          <span>类目 {run.completedCategories}/{run.totalCategories}</span>
          <span>已采商品 {formatNumber(run.collectedItems)}</span>
          {run.attentionCategories ? <span className="text-rose-700">待处理 {run.attentionCategories}</span> : null}
          {!run.expectedItemsKnown ? <span>总量待核对</span> : null}
        </div>
        {expanded ? <div className="business-run-validation">商品类目已校验 {run.validatedCategories} · 非商品入口 {run.excludedCategories} · {run.isDeliverable ? "采集范围已闭环" : "尚未完成全店核对"}</div> : null}
      </div>
      <div className="business-run-percent"><strong>{percent}%</strong><span>类目完整度</span></div>
    </article>
  );
}

function Metric({ icon, label, value, detail, tone = "default" }: { icon: React.ReactNode; label: string; value: string | number; detail: string; tone?: "default" | "success" }) {
  return <article className={`business-metric ${tone}`}><span className="business-metric-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function formatNumber(value?: number): string { return value === undefined ? "--" : new Intl.NumberFormat("zh-CN").format(value); }
function EmptyState({ text }: { text: string }) { return <div className="business-empty">{text}</div>; }
