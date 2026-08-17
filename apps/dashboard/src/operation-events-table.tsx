import { History, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { OperationEventRecord } from "@retail-orchestrator/shared";
import { StatusPill } from "./display.js";
import { PaginationControls } from "./pagination-controls.js";
import { slicePage } from "./pagination.js";
import { safeOperationalText } from "./safe-display.js";

export function OperationEventsTable({ events }: { events: OperationEventRecord[] }) {
  const [page, setPage] = useState(1);
  const eventRows = slicePage(events, page, 30);

  return (
    <section className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-5 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3.5">
          <div className="rounded-xl bg-slate-100 p-3 text-slate-800 border border-slate-200/60 shadow-sm">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h2 className="m-0 text-base md:text-lg font-bold text-slate-900 tracking-tight">生产操作记录</h2>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">完整记录任务恢复、暂停、换号和风险处置，方便复盘与责任追溯</p>
          </div>
        </div>
        <div className="self-start sm:self-center inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3.5 py-1 text-xs font-bold text-slate-700 shadow-sm">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>共 {events.length} 条审计记录</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>触发时间</th>
              <th>操作人员</th>
              <th>操作内容</th>
              <th>影响对象</th>
              <th>关联采集资源</th>
              <th>处理说明</th>
            </tr>
          </thead>
          <tbody>
            {events.length ? (
              eventRows.items.map((event) => (
                <tr key={event.eventId}>
                  <td>
                    <span className="font-mono text-xs font-bold text-slate-800">{formatDateTime(event.createdAt)}</span>
                  </td>
                  <td>
                    <span className="inline-flex items-center rounded-lg bg-slate-100 border border-slate-200/60 px-2.5 py-1 text-xs font-bold text-slate-800">
                      {event.actor}
                    </span>
                  </td>
                  <td>
                    <StatusPill status={event.action} />
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 min-w-[140px]">
                      <span className="font-bold text-xs text-slate-900">{event.targetType}</span>
                      <span className="font-mono text-[11px] text-slate-400 truncate max-w-[180px]" title={event.targetId || ""}>
                        {compressId(event.targetId || "-")}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1 max-w-xs text-[11px] font-mono text-slate-600">
                      {event.workerId ? <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/60">设备：{compressId(event.workerId)}</span> : null}
                      {event.cdpEndpointId ? <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/60">浏览器席位：{compressId(event.cdpEndpointId)}</span> : null}
                      {event.accountId ? <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/60">账号：{event.accountId}</span> : null}
                      {event.profileId ? <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/60">浏览器身份：{compressId(event.profileId)}</span> : null}
                      {event.taskId ? <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/60">任务：{compressId(event.taskId)}</span> : null}
                      {event.riskId ? <span className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200/60">风险：{compressId(event.riskId)}</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className="block max-w-sm truncate rounded-lg bg-slate-50 border border-slate-200/60 px-2.5 py-1.5 text-xs text-slate-600">
                      {summarizeDetail(event.detail)}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-12 text-center text-xs text-slate-400 font-medium">
                  暂无操作审计指令流流水上报
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls {...eventRows} onPageChange={setPage} />
    </section>
  );
}

function summarizeDetail(detail: Record<string, unknown>): string {
  const values = Object.values(detail || {})
    .filter((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 3)
    .map(String);
  return safeOperationalText(values.join(" · ") || "操作已记录");
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

function compressId(value: string) {
  if (!value || value.length <= 14) return value || "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
