import { Server } from "lucide-react";
import type { WorkerStatusRow } from "@retail-orchestrator/shared";
import { StatusPill } from "./display.js";

interface Props {
  workers: WorkerStatusRow[];
}

export function WorkerStatusTable({ workers }: Props) {
  return (
    <div className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60 shadow-sm">
            <Server className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">物理 Worker 节点心跳与账号矩阵追踪</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">全方位展开每个底层计算与浏览器渲染 Worker 当前承载的多账号及 Chrome Profile 会话实例</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          共 {workers.length} 台物理 Worker
        </span>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>物理 Worker 标识 & 主机名</th>
              <th>机房属性标签</th>
              <th>在线心跳状态</th>
              <th>最近活跃时间</th>
              <th>承载采集账号会话</th>
              <th>关联 Chrome Profile</th>
              <th>CDP 端口</th>
              <th>执行目标门店 / 类目</th>
              <th>Worker 实时运行日志摘要</th>
            </tr>
          </thead>
          <tbody>
            {workers.length ? (
              workers.map((row) => {
                const accounts = row.accounts && row.accounts.length ? row.accounts : [undefined];
                return accounts.map((account, index) => (
                  <tr key={`${row.worker.workerId}-${account?.accountId || "empty"}-${index}`} className={index > 0 ? "bg-slate-50/40" : ""}>
                    {index === 0 ? (
                      <>
                        <td rowSpan={accounts.length} className="align-top border-r border-slate-200/60">
                          <div className="flex flex-col gap-0.5 min-w-[150px]">
                            <span className="font-mono text-xs font-bold text-slate-900">{row.worker.workerId}</span>
                            <span className="font-mono text-[11px] text-slate-400">{row.worker.hostname}</span>
                          </div>
                        </td>
                        <td rowSpan={accounts.length} className="align-top border-r border-slate-200/60">
                          <span className="inline-flex items-center rounded-lg bg-slate-100 border border-slate-200/60 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {row.worker.machineLabel || "标准渲染节点"}
                          </span>
                        </td>
                        <td rowSpan={accounts.length} className="align-top border-r border-slate-200/60">
                          <div className="flex min-w-[150px] flex-col items-start gap-2">
                            <StatusPill status={row.worker.status} />
                            <WorkerCapacity execution={row.execution} />
                          </div>
                        </td>
                        <td rowSpan={accounts.length} className="align-top border-r border-slate-200/60 font-mono text-xs text-slate-600">
                          {formatTime(row.worker.lastSeenAt)}
                        </td>
                      </>
                    ) : null}
                    <td>
                      {account ? (
                        <div className="flex flex-col gap-0.5 min-w-[140px]">
                          <span className="font-bold text-xs text-slate-900">{account.displayName}</span>
                          <span className="font-mono text-[11px] text-slate-400">{compressId(account.accountId)}</span>
                          {account.maskedLogin ? <span className="font-mono text-[11px] text-slate-500 font-semibold">{account.maskedLogin}</span> : null}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">当前无绑定账号</span>
                      )}
                    </td>
                    <td>
                      {account ? (
                        <div className="flex flex-col gap-1 items-start min-w-[130px]">
                          <StatusPill status={account.profileStatus} />
                          <span className="font-mono text-[11px] text-slate-400">{compressId(account.profileId)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td>
                      <span className="font-mono text-xs font-bold text-slate-800">{account?.cdpPort || "-"}</span>
                    </td>
                    <td>
                      {account ? (
                        <div className="flex flex-col gap-0.5 text-xs min-w-[130px]">
                          <span className="font-bold text-slate-800">{account.currentStoreName || account.currentStoreId || "空闲"}</span>
                          {account.currentCategoryName ? <span className="text-[11px] text-blue-600 font-semibold">{account.currentCategoryName}</span> : null}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    {index === 0 ? (
                      <td rowSpan={accounts.length} className="align-top border-l border-slate-200/60">
                        <code className="block max-w-sm truncate rounded-lg bg-slate-50 border border-slate-200/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-600" title={row.worker.latestLogSummary || ""}>
                          {row.worker.latestLogSummary || "当前正常心跳汇报中..."}
                        </code>
                      </td>
                    ) : null}
                  </tr>
                ));
              })
            ) : (
              <tr>
                <td colSpan={9} className="text-center py-10 text-xs text-slate-400 font-medium">暂无在线物理 Worker 节点心跳上报</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkerCapacity({ execution }: { execution?: WorkerStatusRow["execution"] }) {
  const lines = formatWorkerCapacity(execution);
  return (
    <div className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
      {lines.map((line) => <span key={line}>{line}</span>)}
    </div>
  );
}

export function formatWorkerCapacity(execution?: WorkerStatusRow["execution"]): string[] {
  if (!execution) return ["设备容量待同步"];
  const lines = [
    `采集中 ${execution.capture.active}/${execution.capture.concurrency}`,
    `等待处理 ${execution.capture.waiting}`,
    `数据处理中 ${execution.productPipeline.active}`
  ];
  if (execution.pressure.level !== "L0") lines.push("系统已自动降速");
  return lines;
}

function formatTime(value: string) {
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
