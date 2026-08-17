import { AlertCircle, CheckCircle2, Clock3 } from "lucide-react";
import type { BusinessActivityRecord, BusinessIssueRecord } from "@retail-orchestrator/shared";
import { formatBusinessTime } from "./business-display.js";

export function BusinessActivity({ activities }: { activities: BusinessActivityRecord[] }) {
  return <div className="business-page"><section className="business-band"><header className="business-section-heading"><div><h2>实时采集动态</h2><p>按门店和类目展示采集进展。</p></div></header><div className="business-feed" aria-live="polite">{activities.length ? activities.map((item) => <div className={`business-feed-row ${item.tone}`} key={item.activityId}><span>{item.tone === "success" ? <CheckCircle2 /> : item.tone === "danger" ? <AlertCircle /> : <Clock3 />}</span><div><strong>{item.message}</strong><small>{formatBusinessTime(item.occurredAt)}</small></div></div>) : <div className="business-empty">暂无采集动态</div>}</div></section></div>;
}

export function BusinessIssues({ issues, onOpenAdmin }: { issues: BusinessIssueRecord[]; onOpenAdmin: () => void }) {
  return <div className="business-page"><section className="business-band"><header className="business-section-heading"><div><h2>异常待办</h2><p>人工处理前，系统不会继续推进受影响的采集入口。</p></div></header><div className="business-issue-list">{issues.length ? issues.map((issue) => <article className="business-issue-row" key={issue.issueId}><span className={`business-severity ${issue.severity}`}>{issue.severity === "critical" ? "紧急" : issue.severity === "high" ? "高" : "关注"}</span><div><strong>{issue.storeName}{issue.categoryName ? ` · ${issue.categoryName}` : ""}</strong><p>{issue.message}</p><small>{formatBusinessTime(issue.occurredAt)}</small></div><button type="button" onClick={onOpenAdmin}>{issue.actionLabel}</button></article>) : <div className="business-empty">暂无需要人工处理的采集任务</div>}</div></section></div>;
}
