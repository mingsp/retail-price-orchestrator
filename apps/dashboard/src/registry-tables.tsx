import { CheckCircle2, ShieldAlert, UserCheck, Users } from "lucide-react";
import type { AccountRegistryRow, CategoryTaskRecord, ProfileRegistryRow, RiskEventRecord, WorkerStatusRow } from "@retail-orchestrator/shared";
import { labelStatus, StatusPill } from "./display.js";
import { safeOperationalText } from "./safe-display.js";
import { formatElapsedSince, reconcileAccountOperationalTruth } from "./truth-metrics.js";

export function AccountTable({
  accounts,
  tasks,
  workers,
  onAction
}: {
  accounts: AccountRegistryRow[];
  tasks: CategoryTaskRecord[];
  workers: WorkerStatusRow[];
  onAction: (accountId: string, action: "safe" | "cooldown" | "manual_required" | "account_blocked") => void;
}) {
  const operationalAccounts = accounts.map((account) => reconcileAccountOperationalTruth(account, tasks));
  const sessionStatusByAccount = new Map<string, string>();
  for (const worker of workers) {
    for (const endpoint of worker.cdpEndpoints || []) {
      if (!endpoint.accountId) continue;
      sessionStatusByAccount.set(endpoint.accountId, worker.worker.status === "online" ? endpoint.status : "offline");
    }
  }
  return (
    <div className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60 shadow-sm">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">采集账号与健康状态</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">查看账号所属设备、浏览器席位、目标门店和风险状态</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          共 {operationalAccounts.length} 个账号
        </span>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>账号名称 / ID</th>
              <th>所属设备</th>
              <th>运行会话状态</th>
              <th>安全风控评估</th>
              <th>浏览器席位</th>
              <th>席位端口</th>
              <th>当前调度任务</th>
              <th>距上次采集</th>
              <th>状态同步时间</th>
              <th className="text-right">应急流转调度</th>
            </tr>
          </thead>
          <tbody>
            {operationalAccounts.length ? (
              operationalAccounts.map((account) => (
                <tr key={account.accountId}>
                  <td>
                    <div className="flex flex-col gap-0.5 min-w-[140px]">
                      <span className="font-bold text-xs text-slate-900">{account.displayName}</span>
                      <span className="font-mono text-[11px] text-slate-400">{compressId(account.accountId)}</span>
                      {account.maskedLogin ? <span className="font-mono text-[11px] text-slate-500 font-semibold">{account.maskedLogin}</span> : null}
                    </div>
                  </td>
                  <td>
                    <span className="font-mono text-xs font-bold text-slate-700">{account.workerId}</span>
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusPill status={sessionStatusByAccount.get(account.accountId) || "unknown"} />
                      <span className="text-[10px] text-slate-400">账号登记：{labelStatus(account.status)}</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={account.riskLevel} />
                  </td>
                  <td>
                    <div className="flex flex-col gap-1 items-start">
                      <StatusPill status={account.profileStatus} />
                      <span className="font-mono text-[11px] text-slate-400 mt-0.5">{compressId(account.profileId)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 font-mono text-xs">
                      <span className="font-bold text-slate-800">{account.cdpPort || "-"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 text-xs min-w-[120px]">
                      <span className="font-bold text-slate-800">{account.operationalSource === "active_task" ? (account.currentStoreName || account.currentStoreId) : "当前空闲"}</span>
                      {account.currentCategoryName ? <span className="text-[11px] text-blue-600 font-semibold">正在采集：{account.currentCategoryName}</span> : <span className="text-[11px] text-slate-400">未领取类目任务</span>}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 text-xs min-w-[110px]">
                      <span className="font-bold text-slate-800">{formatElapsedSince(account.lastCollectedAt)}</span>
                      <span className="text-[11px] text-slate-400">{account.lastCollectedAt ? formatTime(account.lastCollectedAt) : "尚无有效进度"}</span>
                    </div>
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{formatTime(account.updatedAt)}</span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button className="mini-action rounded-lg font-semibold" type="button" onClick={() => onAction(account.accountId, "safe")}>安全</button>
                      <button className="mini-action rounded-lg font-semibold" type="button" onClick={() => onAction(account.accountId, "cooldown")}>冷却</button>
                      <button className="mini-action danger rounded-lg font-semibold" type="button" onClick={() => onAction(account.accountId, "manual_required")}>人工</button>
                      <button className="mini-action danger rounded-lg font-semibold" type="button" onClick={() => onAction(account.accountId, "account_blocked")}>封禁</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} className="text-center py-10 text-xs text-slate-400 font-medium">暂无上报平台账号记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProfileTable({
  profiles,
  onAction
}: {
  profiles: ProfileRegistryRow[];
  onAction: (profileId: string, action: "safe" | "profile_risk" | "retired") => void;
}) {
  return (
    <div className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60 shadow-sm">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">浏览器席位与账号绑定</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">核对每个采集席位的所属设备、登录账号和风险状态</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          {profiles.length} 个实例
        </span>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Profile 标识 ID</th>
              <th>分配物理 Worker</th>
              <th>绑定账号</th>
              <th>凭证状态</th>
              <th>CDP 监听端口</th>
              <th>历史拦截/风控次数</th>
              <th>心跳时间</th>
              <th className="text-right">凭证状态管理</th>
            </tr>
          </thead>
          <tbody>
            {profiles.length ? (
              profiles.map((profile) => (
                <tr key={profile.profileId}>
                  <td>
                    <span className="font-mono text-xs font-bold text-slate-900">{profile.profileId}</span>
                  </td>
                  <td>
                    <span className="font-mono text-xs font-bold text-slate-700">{profile.workerId}</span>
                  </td>
                  <td>
                    <span className="font-semibold text-xs text-slate-800">{profile.accountId || "未绑定账号"}</span>
                  </td>
                  <td>
                    <StatusPill status={profile.status} />
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 font-mono text-xs">
                      <span className="font-bold text-slate-800">{profile.cdpPort || "-"}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`font-mono text-xs font-bold ${profile.riskCount > 0 ? "text-rose-600" : "text-slate-600"}`}>
                      {profile.riskCount} 次
                    </span>
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{formatTime(profile.updatedAt)}</span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button className="mini-action rounded-lg font-semibold" type="button" onClick={() => onAction(profile.profileId, "safe")}>恢复安全</button>
                      <button className="mini-action danger rounded-lg font-semibold" type="button" onClick={() => onAction(profile.profileId, "profile_risk")}>标记风险</button>
                      <button className="mini-action danger rounded-lg font-semibold" type="button" onClick={() => onAction(profile.profileId, "retired")}>下线停用</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center py-10 text-xs text-slate-400 font-medium">暂无浏览器席位记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RiskEventTable({
  risks,
  onAction
}: {
  risks: RiskEventRecord[];
  onAction: (riskId: string, status: RiskEventRecord["status"]) => void;
}) {
  return (
    <div className="table-shell">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-rose-50 p-2.5 text-rose-700 border border-rose-200/60 shadow-sm">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">系统全局反爬与异常警报历史库</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">记录全部自动化抓取过程中被拦截验证或会话失效事件的原始日志信息</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
          共 {risks.length} 条警报
        </span>
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>严重度 / 风险类型</th>
              <th>流转状态</th>
              <th>触发 Worker</th>
              <th>关联账号 / Profile / CDP</th>
              <th>业务门店 / 类目切片</th>
              <th>观测异常现象描述</th>
              <th>中台智能推荐动作</th>
              <th>捕获时间</th>
              <th className="text-right">警报处置</th>
            </tr>
          </thead>
          <tbody>
            {risks.length ? (
              risks.map((risk) => (
                <tr key={risk.riskId}>
                  <td>
                    <div className="flex flex-col gap-1 items-start">
                      <StatusPill status={risk.severity} />
                      <StatusPill status={risk.riskType} className="!text-[10px] !py-0.5 mt-0.5" />
                    </div>
                  </td>
                  <td>
                    <StatusPill status={risk.status} />
                  </td>
                  <td>
                    <span className="font-mono text-xs font-bold text-slate-700">{risk.workerId}</span>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 text-xs">
                      <span className="font-semibold text-slate-800">{risk.accountId || "-"}</span>
                      {risk.profileId ? <span className="font-mono text-[11px] text-slate-400">{compressId(risk.profileId)}</span> : null}
                      {risk.cdpPort ? <span className="font-mono text-[11px] text-indigo-600 font-semibold">CDP Port {risk.cdpPort}</span> : null}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col gap-0.5 text-xs min-w-[130px]">
                      <span className="font-bold text-slate-800">{risk.storeName || risk.storeId || "-"}</span>
                      {risk.categoryName ? <span className="text-[11px] text-slate-500">{risk.categoryName}</span> : null}
                    </div>
                  </td>
                  <td>
                    <p className="m-0 text-xs text-slate-600 max-w-xs leading-relaxed line-clamp-2">{safeOperationalText(risk.observed)}</p>
                  </td>
                  <td>
                    <span className="text-xs font-medium text-amber-700 max-w-xs leading-relaxed block">{safeOperationalText(risk.recommendedAction, "请人工检查并处理")}</span>
                  </td>
                  <td>
                    <span className="font-mono text-xs text-slate-500">{formatTime(risk.createdAt)}</span>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <button className="mini-action rounded-lg font-semibold" type="button" onClick={() => onAction(risk.riskId, "acknowledged")}>确认接手</button>
                      <button className="mini-action rounded-lg font-semibold" type="button" onClick={() => onAction(risk.riskId, "resolved")}>标记解决</button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="text-center py-10 text-xs text-slate-400 font-medium">暂无上报历史风控警报记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
