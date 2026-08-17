import { FolderSync, Layers, Store as StoreIcon } from "lucide-react";
import { useState } from "react";
import type { CategoryTaskRecord, StoreRecord, StoreRunRecord, TaskStatus } from "@retail-orchestrator/shared";
import { formatNumber, StatusPill } from "./display.js";
import { PaginationControls } from "./pagination-controls.js";
import { slicePage } from "./pagination.js";
import { safeOperationalText } from "./safe-display.js";

export function StoreTable({ stores }: { stores: StoreRecord[] }) {
  return (
    <div className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60 shadow-sm">
            <StoreIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">竞对门店建档库列表</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">统一管理各渠道的目标门店、所属城市和采集状态</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          共 {stores.length} 家门店
        </span>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>门店名称 / 唯一编码</th>
              <th>所属电商平台</th>
              <th>巡检监控状态</th>
              <th>平台 POI 标识</th>
              <th>地理行政归属 (城市/商圈)</th>
              <th>最后更新同步</th>
            </tr>
          </thead>
          <tbody>
            {stores.length ? (
              stores.map((store) => (
                <tr key={store.storeId}>
                  <td>
                    <div className="flex flex-col gap-0.5 min-w-[160px]">
                      <span className="font-bold text-xs text-slate-900">{store.name}</span>
                      <span className="font-mono text-[11px] text-slate-400">{compressId(store.storeId)}</span>
                    </div>
                  </td>
                  <td>
                    <span className="inline-flex items-center rounded-lg bg-slate-100 border border-slate-200/60 px-2.5 py-1 font-semibold text-xs text-slate-800">
                      {store.platform || "通用电商"}
                    </span>
                  </td>
                  <td>
                    <StatusPill status={store.status} />
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-600 font-medium">{store.poiIdStr || "-"}</span>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 text-xs">
                      <span className="font-bold text-slate-800">{store.city || "-"}</span>
                      {store.address ? <span className="text-[11px] text-slate-400 truncate max-w-[200px]" title={store.address}>{store.address}</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{formatTime(store.updatedAt)}</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="text-center py-10 text-xs text-slate-400 font-medium">暂无上报竞对门店记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RunTable({ runs }: { runs: StoreRunRecord[] }) {
  return (
    <div className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60 shadow-sm">
            <FolderSync className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">门店采集批次</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">查看每一轮全店采集的执行状态、分工策略和计划完成时间</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          共 {runs.length} 个批次
        </span>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>批次名称 / 编号</th>
              <th>关联门店实体</th>
              <th>执行流转状态</th>
              <th>任务分工调度策略</th>
              <th>计划预期完工时限</th>
              <th>最后状态同步</th>
            </tr>
          </thead>
          <tbody>
            {runs.length ? (
              runs.map((run) => (
                <tr key={run.runId}>
                  <td>
                    <div className="flex flex-col gap-0.5 min-w-[160px]">
                      <span className="font-bold text-xs text-slate-900">{run.runLabel}</span>
                      <span className="font-mono text-[11px] text-slate-400">{compressId(run.runId)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 text-xs min-w-[140px]">
                      <span className="font-bold text-slate-800">{run.storeName || run.storeId}</span>
                      <span className="font-mono text-[11px] text-slate-400">{compressId(run.storeId)}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={run.status} />
                  </td>
                  <td>
                    <span className="inline-flex items-center rounded-lg bg-slate-100 border border-slate-200/60 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {run.strategy === "account_rotation" ? "账号轮换采集" : "按类目并发切片"}
                    </span>
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-600">{run.targetFinishAt ? formatTime(run.targetFinishAt) : "不限时间"}</span>
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{formatTime(run.updatedAt)}</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="text-center py-10 text-xs text-slate-400 font-medium">暂无上报采集计划批次记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TaskTable({
  tasks,
  onAction
}: {
  tasks: CategoryTaskRecord[];
  onAction: (taskId: string, status: TaskStatus) => void;
}) {
  const [page, setPage] = useState(1);
  const taskRows = slicePage(tasks, page, 30);

  return (
    <div className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60 shadow-sm">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">细粒度类目切片调度任务明细表</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">展示每个类目的负责设备、账号、浏览器席位和已采商品进度</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          共 {tasks.length} 个任务
        </span>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>切片任务 / 顺序与优先级</th>
              <th>关联门店及所属批次</th>
              <th>当前执行状态</th>
              <th>负责设备 / 账号 / 浏览器席位</th>
              <th>已采商品</th>
              <th>待处理说明</th>
              <th>同步时间</th>
              <th className="text-right">状态控制</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length ? (
              taskRows.items.map((task) => (
                <tr key={task.taskId}>
                  <td>
                    <div className="flex flex-col gap-0.5 min-w-[150px]">
                      <span className="font-bold text-xs text-slate-900">{task.categoryName}</span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        切片 #{task.categoryOrder} · 优先级 #{task.priority}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">{compressId(task.taskId)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 text-xs min-w-[130px]">
                      <span className="font-bold text-slate-800">{task.storeName || task.storeId}</span>
                      <span className="font-mono text-[11px] text-slate-400">批次: {compressId(task.runId)}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={task.status} />
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 font-mono text-[11px] min-w-[150px]">
                      <span className="text-slate-800 font-semibold">设备: {compressId(task.assignedWorkerId || "待分配")}</span>
                      {task.assignedAccountId ? <span className="text-slate-600">账号: {task.assignedAccountId}</span> : null}
                      {task.assignedProfileId ? <span className="text-slate-400">浏览器: {compressId(task.assignedProfileId)}</span> : null}
                      {task.assignedCdpEndpointId ? <span className="text-indigo-600 font-semibold">席位: {compressId(task.assignedCdpEndpointId)}</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 font-mono text-xs min-w-[90px]">
                      <span className="font-extrabold text-slate-900">{formatNumber(task.collectedItems)} 件</span>
                      {task.expectedItems ? <span className="text-[11px] text-slate-400 font-medium">预估 {formatNumber(task.expectedItems)}</span> : null}
                    </div>
                  </td>
                  <td>
                    {task.lastError ? (
                      <div className="max-w-xs truncate rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700">
                        {safeOperationalText(task.lastError)}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{formatTime(task.updatedAt)}</span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      <button className="mini-action rounded-lg font-semibold" type="button" onClick={() => onAction(task.taskId, "pending")}>重新排队</button>
                      <button className="mini-action rounded-lg font-semibold" type="button" onClick={() => onAction(task.taskId, "paused")}>暂停</button>
                      <button className="mini-action danger rounded-lg font-semibold" type="button" onClick={() => onAction(task.taskId, "manual_required")}>人工</button>
                      <button className="mini-action danger rounded-lg font-semibold" type="button" onClick={() => onAction(task.taskId, "failed")}>报错</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center py-10 text-xs text-slate-400 font-medium">暂无具体类目切片执行任务上报</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls {...taskRows} onPageChange={setPage} />
    </div>
  );
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
