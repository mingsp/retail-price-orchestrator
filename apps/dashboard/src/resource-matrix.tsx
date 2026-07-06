import { Activity, Cpu, Monitor, Network, ShieldAlert, UserRoundCog } from "lucide-react";
import type { ReactNode } from "react";
import type { AccountSnapshot, WorkerStatusRow } from "@retail-orchestrator/shared";
import { labelStatus } from "./display.js";

interface Props {
  workers: WorkerStatusRow[];
}

export function ResourceMatrix({ workers }: Props) {
  const accountCount = workers.reduce((sum, row) => sum + row.accounts.length, 0);
  const riskAccounts = workers.flatMap((row) => row.accounts).filter(isRiskAccount).length;
  const cdpPorts = new Set(workers.flatMap((row) => row.accounts.map((account) => account.cdpPort).filter(Boolean)));
  const onlineWorkers = workers.filter((row) => row.worker.status === "online").length;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-4 gap-4">
        <MatrixStat icon={<Monitor className="h-5 w-5" />} label="Worker 设备" value={`${onlineWorkers}/${workers.length}`} hint="在线/总数" tone={workers.length && onlineWorkers === workers.length ? "green" : "amber"} />
        <MatrixStat icon={<UserRoundCog className="h-5 w-5" />} label="账号绑定" value={`${accountCount}`} hint="已上报账号" tone="blue" />
        <MatrixStat icon={<Cpu className="h-5 w-5" />} label="CDP 端口" value={`${cdpPorts.size}`} hint="当前可识别端口" tone="indigo" />
        <MatrixStat icon={<ShieldAlert className="h-5 w-5" />} label="风险账号" value={`${riskAccounts}`} hint="非安全或非正常风险等级" tone={riskAccounts ? "red" : "green"} />
      </section>

      {workers.length ? (
        <section className="grid grid-cols-2 gap-5">
          {workers.map((row) => (
            <WorkerPanel row={row} key={row.worker.workerId} />
          ))}
        </section>
      ) : (
        <div className="glass-panel rounded-lg p-10 text-center">
          <Monitor className="mx-auto h-10 w-10 text-slate-300" />
          <div className="mt-3 text-base font-semibold text-slate-800">暂无 Worker 心跳</div>
          <div className="mt-1 text-sm text-slate-500">启动 worker 后，这里会展示设备、CDP、Profile、账号和当前采集类目的绑定关系。</div>
        </div>
      )}
    </div>
  );
}

function WorkerPanel({ row }: { row: WorkerStatusRow }) {
  const riskAccounts = row.accounts.filter(isRiskAccount);
  return (
    <article className="glass-panel rounded-lg p-5">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`status-dot ${row.worker.status === "online" ? "bg-emerald-500" : row.worker.status === "device_risk" ? "bg-red-500" : "bg-amber-500"}`} />
            <h2 className="m-0 truncate text-lg font-semibold text-slate-950">{row.worker.machineLabel}</h2>
          </div>
          <div className="mt-1 truncate text-xs text-slate-500">{row.worker.workerId} · {row.worker.hostname}</div>
        </div>
        <span className={`pill pill-${row.worker.status}`}>{labelStatus(row.worker.status)}</span>
      </header>

      <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
        <InfoTile label="系统" value={row.worker.os || "-"} />
        <InfoTile label="网络" value={labelNetwork(row.worker.networkMode)} />
        <InfoTile label="账号" value={`${row.accounts.length}`} />
        <InfoTile label="风险" value={`${riskAccounts.length}`} tone={riskAccounts.length ? "red" : "green"} />
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
        <div className="flex items-center gap-2 font-medium text-slate-700">
          <Activity className="h-3.5 w-3.5 text-blue-600" />
          最近日志
        </div>
        <div className="mt-1">{row.worker.latestLogSummary || "暂无日志摘要"}</div>
        <div className="mt-1 text-slate-400">最后心跳：{formatDateTime(row.worker.lastSeenAt)}</div>
      </div>

      <div className="mt-4 space-y-3">
        {row.accounts.length ? (
          row.accounts.map((account) => <AccountBindingCard account={account} key={account.accountId} />)
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">该 Worker 暂未上报账号/Profile 绑定。</div>
        )}
      </div>
    </article>
  );
}

function AccountBindingCard({ account }: { account: AccountSnapshot }) {
  const risk = isRiskAccount(account);
  return (
    <div className={`rounded-lg border bg-white p-4 ${risk ? "border-red-200" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{account.displayName || account.accountId}</div>
          <div className="mt-1 truncate text-xs text-slate-500">{account.maskedLogin || account.accountId}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <span className={`pill pill-${account.status}`}>{labelStatus(account.status)}</span>
          <span className={`pill pill-${account.riskLevel}`}>{labelStatus(account.riskLevel)}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[1.1fr_0.8fr_0.8fr] gap-2 text-xs">
        <InfoTile label="Profile" value={account.profileId} tone={account.profileStatus === "safe" ? "green" : "red"} />
        <InfoTile label="Profile状态" value={labelStatus(account.profileStatus)} tone={account.profileStatus === "safe" ? "green" : "red"} />
        <InfoTile label="CDP" value={`${account.cdpPort}`} />
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Network className="h-3.5 w-3.5 text-slate-400" />
        <span className="min-w-0 truncate">
          {account.currentStoreName || account.currentStoreId || "未上报当前门店"}
          {account.currentCategoryName ? ` / ${account.currentCategoryName}` : ""}
        </span>
      </div>
    </div>
  );
}

function MatrixStat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: "blue" | "indigo" | "green" | "amber" | "red" }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-100",
    green: "bg-emerald-50 text-emerald-700 border-emerald-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    red: "bg-red-50 text-red-700 border-red-100"
  }[tone];
  return (
    <div className="glass-panel rounded-lg p-5">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${toneClass}`}>{icon}</div>
      <div className="mt-4 text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function InfoTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "red" }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-800";
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`mt-0.5 truncate font-semibold ${toneClass}`} title={value}>{value || "-"}</div>
    </div>
  );
}

function isRiskAccount(account: AccountSnapshot) {
  return account.status !== "safe" || account.riskLevel !== "normal" || account.profileStatus !== "safe";
}

function labelNetwork(value: string) {
  if (value === "direct") return "直连";
  if (value === "proxy") return "代理";
  return "未知";
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
