import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileWarning,
  Monitor,
  RotateCcw,
  ShieldAlert,
  UserRoundX
} from "lucide-react";
import type { RiskEventRecord } from "@retail-orchestrator/shared";
import { labelStatus } from "./display.js";

interface Props {
  risks: RiskEventRecord[];
  onAction: (riskId: string, status: RiskEventRecord["status"]) => void;
}

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

export function RiskInterventionStation({ risks, onAction }: Props) {
  const sortedRisks = useMemo(() => sortRisks(risks), [risks]);
  const [selectedId, setSelectedId] = useState("");
  const selected = sortedRisks.find((risk) => risk.riskId === selectedId) || sortedRisks.find((risk) => risk.status !== "resolved") || sortedRisks[0];
  const openCount = risks.filter((risk) => risk.status === "open").length;
  const criticalCount = risks.filter((risk) => risk.status !== "resolved" && (risk.severity === "critical" || risk.severity === "high")).length;
  const resolvedCount = risks.filter((risk) => risk.status === "resolved").length;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-4 gap-4">
        <RiskStat icon={<ShieldAlert className="h-5 w-5" />} label="待处理事件" value={`${openCount}`} tone={openCount ? "red" : "green"} />
        <RiskStat icon={<AlertTriangle className="h-5 w-5" />} label="高危/严重" value={`${criticalCount}`} tone={criticalCount ? "red" : "green"} />
        <RiskStat icon={<CheckCircle2 className="h-5 w-5" />} label="已解决" value={`${resolvedCount}`} tone="green" />
        <RiskStat icon={<Clock3 className="h-5 w-5" />} label="事件总量" value={`${risks.length}`} tone="blue" />
      </section>

      <section className="grid grid-cols-[420px_1fr] gap-5">
        <aside className="glass-panel rounded-lg p-4">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="m-0 text-lg font-semibold text-slate-950">风控事件队列</h2>
              <div className="mt-1 text-sm text-slate-500">按严重程度、状态和创建时间排序</div>
            </div>
            <span className="pill pill-open">{openCount} 待处理</span>
          </div>

          <div className="mt-4 max-h-[680px] space-y-3 overflow-auto pr-1">
            {sortedRisks.length ? (
              sortedRisks.map((risk) => (
                <button
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selected?.riskId === risk.riskId
                      ? "border-blue-300 bg-blue-50"
                      : risk.status === "resolved"
                        ? "border-slate-200 bg-white"
                        : "border-amber-200 bg-amber-50"
                  }`}
                  key={risk.riskId}
                  type="button"
                  onClick={() => setSelectedId(risk.riskId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`pill pill-${risk.severity}`}>{labelStatus(risk.severity)}</span>
                        <span className={`pill pill-${risk.riskType}`}>{labelStatus(risk.riskType)}</span>
                        <span className={`pill pill-${risk.status}`}>{labelStatus(risk.status)}</span>
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-slate-900">{risk.accountId || risk.workerId}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{risk.storeName || risk.storeId || "未知门店"} / {risk.categoryName || "未知类目"}</div>
                    </div>
                    <div className="shrink-0 text-xs text-slate-400">{formatTime(risk.createdAt)}</div>
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{risk.observed}</div>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">暂无风控事件。</div>
            )}
          </div>
        </aside>

        <main className="glass-panel rounded-lg p-5">
          {selected ? (
            <RiskActionPanel risk={selected} onAction={onAction} />
          ) : (
            <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
              <CheckCircle2 className="h-12 w-12 text-slate-300" />
              <div className="mt-3 text-base font-semibold text-slate-800">没有需要处理的风险事件</div>
              <div className="mt-1 text-sm text-slate-500">验证码、403/418、登录异常、账号封禁会进入这里。</div>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function RiskActionPanel({ risk, onAction }: { risk: RiskEventRecord; onAction: Props["onAction"] }) {
  const resolved = risk.status === "resolved";
  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill pill-${risk.severity}`}>{labelStatus(risk.severity)}</span>
            <span className={`pill pill-${risk.riskType}`}>{labelStatus(risk.riskType)}</span>
            <span className={`pill pill-${risk.status}`}>{labelStatus(risk.status)}</span>
          </div>
          <h2 className="m-0 mt-3 text-xl font-semibold text-slate-950">{risk.accountId || risk.workerId}</h2>
          <div className="mt-1 text-sm text-slate-500">{risk.storeName || risk.storeId || "未知门店"} / {risk.categoryName || "未知类目"}</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>创建时间</div>
          <div className="mt-1 font-semibold text-slate-800">{formatDateTime(risk.createdAt)}</div>
        </div>
      </header>

      <section className="grid grid-cols-[1.05fr_0.95fr] gap-5">
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Monitor className="h-4 w-4 text-blue-600" />
              现场还原
            </div>
            <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <FileWarning className="mx-auto h-10 w-10 text-slate-300" />
              <div className="mt-2 text-sm font-semibold text-slate-700">截图/页面快照待接入</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">后续 worker 上传 screenshot artifact 后，这里直接显示验证码、403/418 或登录页现场。</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">异常现象</div>
            <p className="mb-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{risk.observed}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">定位信息</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <ContextTile label="Worker" value={risk.workerId} />
              <ContextTile label="账号" value={risk.accountId || "-"} />
              <ContextTile label="Profile" value={risk.profileId || "-"} />
              <ContextTile label="CDP" value={risk.cdpPort ? `${risk.cdpPort}` : "-"} />
              <ContextTile label="阶段" value={risk.phase || "-"} />
              <ContextTile label="Risk ID" value={risk.riskId} />
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-800">建议动作</div>
            <p className="mb-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-700">{risk.recommendedAction || "等待人工判断：恢复、换号、下线 Profile 或休眠任务。"}</p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">处置动作</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="action-button" disabled={resolved} type="button" onClick={() => onAction(risk.riskId, "acknowledged")}>
                <ShieldAlert className="h-4 w-4" />
                确认接手
              </button>
              <button className="action-button" disabled={resolved} type="button" onClick={() => onAction(risk.riskId, "resolved")}>
                <CheckCircle2 className="h-4 w-4" />
                标记解决
              </button>
              <button className="action-button" disabled type="button" title="下一阶段接入任务恢复 API">
                <RotateCcw className="h-4 w-4" />
                恢复任务
              </button>
              <button className="action-button danger" disabled type="button" title="下一阶段接入账号下线 API">
                <UserRoundX className="h-4 w-4" />
                下线账号
              </button>
            </div>
            <div className="mt-3 text-xs leading-5 text-slate-500">当前已支持确认和解决；换号、休眠、恢复任务会在调度 API 完成后接入。</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function RiskStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "blue" | "green" | "red" }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100",
    red: "bg-red-50 text-red-700 border-red-100"
  }[tone];
  return (
    <div className="glass-panel rounded-lg p-5">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${toneClass}`}>{icon}</div>
      <div className="mt-4 text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function ContextTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 truncate font-semibold text-slate-800" title={value}>{value}</div>
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
