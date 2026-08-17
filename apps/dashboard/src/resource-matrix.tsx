import { Activity, Cpu, ExternalLink, Monitor, Network, Play, ShieldAlert, Square, UserRoundCog } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type {
  AccountRegistryRow,
  AccountSnapshot,
  BrowserSlotRecord,
  CategoryTaskRecord,
  CdpEndpointRecord,
  ProfileRegistryRow,
  StoreRecord,
  WorkerStatusRow
} from "@retail-orchestrator/shared";
import { bindBrowserSlot, createBrowserSlot, createCdpCommand } from "./api.js";
import { labelStatus, StatusPill } from "./display.js";
import { formatElapsedSince, reconcileAccountOperationalTruth } from "./truth-metrics.js";

interface Props {
  workers: WorkerStatusRow[];
  tasks: CategoryTaskRecord[];
  slots: BrowserSlotRecord[];
  accounts: AccountRegistryRow[];
  profiles: ProfileRegistryRow[];
  stores: StoreRecord[];
  onAction?: (action: () => Promise<unknown>) => Promise<void>;
}

export function ResourceMatrix({ workers, tasks, slots, accounts, profiles, stores, onAction }: Props) {
  const accountCount = workers.reduce((sum, row) => sum + row.accounts.length, 0);
  const riskAccounts = workers.flatMap((row) => row.accounts).filter(isRiskAccount).length;
  const onlineWorkers = workers.filter((row) => row.worker.status === "online").length;

  return (
    <div className="space-y-6 md:space-y-8">
      <CdpLaunchPanel workers={workers} onAction={onAction} />

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <MatrixStat icon={<Monitor className="h-5 w-5" />} label="采集设备" value={`${onlineWorkers}/${workers.length}`} hint="在线/总数" tone={workers.length && onlineWorkers === workers.length ? "green" : "amber"} />
        <MatrixStat icon={<UserRoundCog className="h-5 w-5" />} label="账号绑定" value={`${accountCount}`} hint="已上报账号" tone="blue" />
        <MatrixStat icon={<Cpu className="h-5 w-5" />} label="浏览器席位" value={`${slots.filter((slot) => slot.status !== "retired").length}`} hint="已登记稳定席位" tone="indigo" />
        <MatrixStat icon={<ShieldAlert className="h-5 w-5" />} label="风险账号" value={`${riskAccounts}`} hint="非安全或非正常风险等级" tone={riskAccounts ? "red" : "green"} />
      </section>

      {workers.length ? (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {workers.map((row) => (
            <WorkerPanel
              row={row}
              tasks={tasks}
              slots={slots.filter((slot) => slot.workerId === row.worker.workerId)}
              accounts={accounts.filter((account) => account.workerId === row.worker.workerId)}
              profiles={profiles.filter((profile) => profile.workerId === row.worker.workerId)}
              stores={stores}
              key={row.worker.workerId}
              onAction={onAction}
            />
          ))}
        </section>
      ) : (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <Monitor className="mx-auto h-12 w-12 text-slate-300" />
          <div className="mt-4 text-base font-bold text-slate-800">暂无采集设备在线</div>
          <div className="mt-1.5 text-xs text-slate-500 max-w-md mx-auto">设备连接后，这里会展示浏览器席位、登录账号、目标门店和当前类目的绑定关系。</div>
        </div>
      )}
    </div>
  );
}

function CdpLaunchPanel({ workers, onAction }: { workers: WorkerStatusRow[]; onAction?: Props["onAction"] }) {
  const firstWorkerId = workers[0]?.worker.workerId || "";
  const [workerId, setWorkerId] = useState(firstWorkerId);
  const [port, setPort] = useState("9256");
  const [profileId, setProfileId] = useState("profile-9256");
  const [slotLabel, setSlotLabel] = useState("采集席位 01");
  const [maskedLogin, setMaskedLogin] = useState("");
  const [operatorOwner, setOperatorOwner] = useState("");
  const [targetStoreName, setTargetStoreName] = useState("");

  const submit = () => {
    const targetWorkerId = workerId || firstWorkerId;
    if (!targetWorkerId || !port || !profileId) return;
    const action = async () => {
      const slot = await createBrowserSlot({
        workerId: targetWorkerId,
        label: slotLabel,
        port: Number(port)
      });
      return createCdpCommand({
        slotId: slot.slotId,
        workerId: targetWorkerId,
        action: "launch_profile",
        port: Number(port),
        profileId,
        maskedLogin,
        operatorOwner,
        targetStoreName,
        proxyMode: "system"
      });
    };
    if (onAction) return onAction(action);
    return action();
  };

  return (
    <section className="glass-panel rounded-2xl p-5 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="m-0 text-base md:text-lg font-bold text-slate-900 tracking-tight">启动浏览器席位</h2>
          <p className="m-0 mt-1 text-xs font-medium text-slate-500">向目标采集设备下发启动指令，并打开账号与门店标识页。</p>
        </div>
        <button className="primary-action shrink-0" type="button" onClick={submit}>
          <Play className="h-4 w-4" />
          立即下发启动
        </button>
      </div>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-4">
        <SmallInput label="采集设备标识" value={workerId || firstWorkerId} onChange={setWorkerId} placeholder="mm-worker" />
        <SmallInput label="稳定席位名称" value={slotLabel} onChange={setSlotLabel} placeholder="乐购达-A01" />
        <SmallInput label="浏览器调试端口" value={port} onChange={setPort} placeholder="9256" />
        <SmallInput label="浏览器席位标识" value={profileId} onChange={setProfileId} placeholder="profile-9256" />
        <SmallInput label="手机号登录标识" value={maskedLogin} onChange={setMaskedLogin} placeholder="183****2030" />
        <SmallInput label="责任人/归属" value={operatorOwner} onChange={setOperatorOwner} placeholder="运营甲" />
        <SmallInput label="目标门店名称" value={targetStoreName} onChange={setTargetStoreName} placeholder="呱呱南门" />
      </div>
    </section>
  );
}

function WorkerPanel({ row, tasks, slots, accounts, profiles, stores, onAction }: {
  row: WorkerStatusRow;
  tasks: CategoryTaskRecord[];
  slots: BrowserSlotRecord[];
  accounts: AccountRegistryRow[];
  profiles: ProfileRegistryRow[];
  stores: StoreRecord[];
  onAction?: Props["onAction"];
}) {
  const riskAccounts = row.accounts.filter(isRiskAccount);
  const endpoints = readWorkerCdpEndpoints(row);
  return (
    <article className="glass-panel rounded-2xl p-5 md:p-6 transition-all hover:border-slate-300">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={`status-dot ${row.worker.status === "online" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : row.worker.status === "device_risk" ? "bg-rose-500" : "bg-amber-500"}`} />
            <h2 className="m-0 truncate text-lg font-bold text-slate-900 tracking-tight">{row.worker.machineLabel}</h2>
          </div>
          <div className="mt-1 truncate text-xs text-slate-400 font-medium">{row.worker.workerId} · {row.worker.hostname}</div>
        </div>
        <StatusPill status={row.worker.status} />
      </header>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
        <InfoTile label="操作系统" value={row.worker.os || "-"} />
        <InfoTile label="网络模式" value={labelNetwork(row.worker.networkMode)} />
        <InfoTile label="账号绑定" value={`${row.accounts.length}`} />
        <InfoTile label="浏览器席位" value={`${slots.length || endpoints.length}`} />
        <InfoTile label="风险提示" value={`${riskAccounts.length}`} tone={riskAccounts.length ? "red" : "green"} />
      </div>

      <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
        <div className="flex items-center gap-2 font-bold text-slate-700">
          <Activity className="h-3.5 w-3.5 text-blue-600" />
          <span>最新运行日志摘要</span>
        </div>
        <div className="mt-1 font-mono text-slate-700 truncate">{row.worker.latestLogSummary || "暂无日志上报摘要"}</div>
        <div className="mt-1.5 text-[11px] text-slate-400 font-medium">最后通信心跳：{formatDateTime(row.worker.lastSeenAt)}</div>
      </div>

      <div className="mt-5 space-y-3.5">
        {slots.length || endpoints.length ? (
          slots.length
            ? slots.map((slot) => (
                <CdpEndpointCard
                  slot={slot}
                  endpoint={endpoints.find((endpoint) => endpoint.slotId === slot.slotId)}
                  tasks={tasks}
                  worker={row}
                  accounts={accounts}
                  profiles={profiles}
                  stores={stores}
                  key={slot.slotId}
                  onAction={onAction}
                />
              ))
            : endpoints.map((endpoint) => (
                <CdpEndpointCard endpoint={endpoint} tasks={tasks} worker={row} accounts={accounts} profiles={profiles} stores={stores} key={endpoint.endpointId} onAction={onAction} />
              ))
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-5 text-center text-xs font-medium text-slate-400">
            当前采集设备尚未上报浏览器席位绑定信息。
          </div>
        )}
      </div>
    </article>
  );
}

function CdpEndpointCard({ slot, endpoint: observedEndpoint, tasks, worker, accounts, profiles, stores, onAction }: {
  slot?: BrowserSlotRecord;
  endpoint?: CdpEndpointRecord;
  tasks: CategoryTaskRecord[];
  worker: WorkerStatusRow;
  accounts: AccountRegistryRow[];
  profiles: ProfileRegistryRow[];
  stores: StoreRecord[];
  onAction?: Props["onAction"];
}) {
  const endpoint = observedEndpoint || slotToEndpoint(slot!, worker.worker.lastSeenAt);
  const workerOnline = worker.worker.status === "online";
  const risk = ["manual_required", "login_required", "profile_risk", "retired"].includes(endpoint.status);
  const activeTask = tasks.find((task) => task.assignedCdpEndpointId === endpoint.endpointId && isTaskActive(task.status));
  const accountTruth = endpoint.accountId
    ? reconcileAccountOperationalTruth({
        accountId: endpoint.accountId,
        displayName: endpoint.accountDisplayName || endpoint.accountId,
        maskedLogin: endpoint.maskedLogin,
        status: "safe",
        riskLevel: "normal",
        profileId: endpoint.profileId || "",
        profileStatus: endpoint.status === "profile_risk" ? "profile_risk" : "safe",
        profilePath: "",
        cdpPort: endpoint.port,
        currentStoreId: endpoint.targetStoreId,
        currentStoreName: endpoint.targetStoreName
      }, tasks)
    : undefined;
  const queue = (action: "open_identity_page" | "mark_profile_risk" | "retire_profile" | "stop_profile") => {
    const run = () =>
      createCdpCommand({
        slotId: slot?.slotId || endpoint.slotId,
        workerId: endpoint.workerId,
        action,
        port: endpoint.port,
        endpointId: endpoint.endpointId,
        profileId: endpoint.profileId || `${endpoint.workerId}-profile-${endpoint.port}`,
        accountId: endpoint.accountId,
        accountDisplayName: endpoint.accountDisplayName,
        maskedLogin: endpoint.maskedLogin,
        operatorOwner: endpoint.operatorOwner,
        targetStoreId: endpoint.targetStoreId,
        targetStoreName: endpoint.targetStoreName,
        proxyMode: "system"
      });
    if (onAction) return onAction(run);
    return run();
  };
  return (
    <div className={`rounded-xl border bg-white p-4 transition shadow-sm ${risk ? "border-rose-200/90 bg-rose-50/20" : "border-slate-200/80 hover:border-slate-300"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-slate-900">{slot?.label || endpoint.profileId || "未登记席位"}</div>
          <div className="mt-0.5 truncate text-xs text-slate-400 font-medium">运行端口 {endpoint.port}</div>
        </div>
        <StatusPill status={endpoint.status} />
      </div>

      <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        <InfoTile label="席位标识" value={endpoint.profileId || "-"} tone={endpoint.status === "profile_risk" ? "red" : "neutral"} />
        <InfoTile label="上报账号" value={endpoint.accountDisplayName || endpoint.accountId || "-"} />
        <InfoTile label="绑定手机号" value={endpoint.maskedLogin || "-"} />
      </div>

      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <InfoTile label="归属人" value={endpoint.operatorOwner || "-"} />
        <InfoTile label="当前门店" value={activeTask?.storeName || activeTask?.storeId || endpoint.targetStoreName || endpoint.targetStoreId || "未绑定"} />
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
        <Network className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="min-w-0 truncate">
          {!workerOnline
            ? "设备离线，页面状态不是实时数据"
            : activeTask
              ? `正在采集 ${activeTask.categoryName}`
              : endpoint.lastSeenTitle
                ? `页面观测：${endpoint.lastSeenTitle}`
                : "CDP 已连接，等待任务"}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <InfoTile label="距上次采集" value={formatElapsedSince(accountTruth?.lastCollectedAt)} />
        <InfoTile label="席位状态时效" value={workerOnline ? `心跳更新 ${formatElapsedSince(endpoint.updatedAt)}` : "非实时"} tone={workerOnline ? "green" : "red"} />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
        <RemoteDesktopButton worker={worker} slot={slot} />
        <button className="mini-action rounded-lg font-medium" type="button" onClick={() => queue("open_identity_page")}>打开标识页</button>
        <button className="mini-action danger rounded-lg font-medium" type="button" onClick={() => queue("mark_profile_risk")}>标记异常</button>
        <button className="mini-action danger rounded-lg font-medium" type="button" onClick={() => queue("retire_profile")}>停用席位</button>
        <button className="mini-action rounded-lg font-medium" type="button" onClick={() => queue("stop_profile")}>
          <Square className="h-3 w-3" />
          <span>停止进程</span>
        </button>
      </div>
      {slot ? <SlotBindingControls slot={slot} accounts={accounts} profiles={profiles} stores={stores} onAction={onAction} /> : null}
    </div>
  );
}

function SlotBindingControls({ slot, accounts, profiles, stores, onAction }: {
  slot: BrowserSlotRecord;
  accounts: AccountRegistryRow[];
  profiles: ProfileRegistryRow[];
  stores: StoreRecord[];
  onAction?: Props["onAction"];
}) {
  const [accountId, setAccountId] = useState(slot.accountId || accounts[0]?.accountId || "");
  const selectedAccount = accounts.find((account) => account.accountId === accountId);
  const [storeId, setStoreId] = useState(slot.targetStoreId || stores[0]?.storeId || "");
  const profileId = selectedAccount?.profileId || slot.profileId || profiles[0]?.profileId || "";
  const submit = () => {
    if (!accountId || !profileId || !storeId) return;
    const action = () => bindBrowserSlot(slot.slotId, { accountId, profileId, targetStoreId: storeId });
    return onAction ? onAction(action) : action();
  };
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_1fr_auto]">
      <select className="small-select" value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="绑定账号">
        <option value="">选择账号</option>
        {accounts.map((account) => <option value={account.accountId} key={account.accountId}>{account.displayName}</option>)}
      </select>
      <select className="small-select" value={storeId} onChange={(event) => setStoreId(event.target.value)} aria-label="目标门店">
        <option value="">选择目标门店</option>
        {stores.filter((store) => store.status === "active").map((store) => <option value={store.storeId} key={store.storeId}>{store.name}</option>)}
      </select>
      <button className="mini-action rounded-lg font-medium" type="button" disabled={!accountId || !profileId || !storeId} onClick={submit}>确认绑定</button>
    </div>
  );
}

function RemoteDesktopButton({ worker, slot }: { worker: WorkerStatusRow; slot?: BrowserSlotRecord }) {
  const remote = worker.worker.remoteDesktop;
  const target = slot?.remoteDesktopTarget || remote?.target;
  const href = remote?.status === "ready" ? remoteDesktopHref(remote.provider, target) : undefined;
  return (
    <a
      className={`mini-action rounded-lg font-medium ${href ? "" : "pointer-events-none opacity-45"}`}
      href={href || undefined}
      title={href ? "打开已配置的局域网远程处理工具" : "该设备尚未配置远程处理入口"}
    >
      <ExternalLink className="h-3 w-3" />
      <span>远程处理</span>
    </a>
  );
}

export function remoteDesktopHref(provider: string | undefined, target: string | undefined): string | undefined {
  if (!target || !/^[a-zA-Z0-9._:-]+$/.test(target)) return undefined;
  if (provider === "rustdesk") return `rustdesk://connection/new/${encodeURIComponent(target)}`;
  if (provider === "rdp") return `ms-rd:connect?target=${encodeURIComponent(target)}`;
  if (provider === "screen_sharing") return `vnc://${target}`;
  return undefined;
}

function slotToEndpoint(slot: BrowserSlotRecord, updatedAt: string): CdpEndpointRecord {
  return {
    slotId: slot.slotId,
    endpointId: `slot:${slot.slotId}`,
    workerId: slot.workerId,
    host: "127.0.0.1",
    port: slot.port,
    endpointUrl: "",
    status: slot.status,
    profileId: slot.profileId,
    accountId: slot.accountId,
    targetStoreId: slot.targetStoreId,
    updatedAt
  };
}

function SmallInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      <span>{label}</span>
      <input
        className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none transition focus:border-slate-800 focus:ring-2 focus:ring-slate-900/10 shadow-sm"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MatrixStat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: "blue" | "indigo" | "green" | "amber" | "red" }) {
  const iconClass = {
    blue: "bg-slate-100 text-slate-800 border-slate-200/80",
    indigo: "bg-slate-100 text-slate-800 border-slate-200/80",
    green: "bg-emerald-50 text-emerald-700 border-emerald-200/60",
    amber: "bg-amber-50 text-amber-700 border-amber-200/60",
    red: "bg-rose-50 text-rose-700 border-rose-200/60"
  }[tone];
  return (
    <div className="glass-panel rounded-2xl p-5 md:p-6 transition hover:border-slate-300">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${iconClass}`}>{icon}</div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500">{hint}</div>
    </div>
  );
}

function InfoTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "red" }) {
  const toneClass = tone === "green" ? "text-emerald-700 bg-emerald-50/60 border-emerald-200/60" : tone === "red" ? "text-rose-700 bg-rose-50/60 border-rose-200/60" : "text-slate-800 bg-slate-50 border-slate-200/80";
  return (
    <div className={`min-w-0 rounded-lg border px-2.5 py-1.5 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{label}</div>
      <div className="mt-0.5 truncate font-bold text-xs" title={value}>{value || "-"}</div>
    </div>
  );
}

function isRiskAccount(account: AccountSnapshot) {
  return account.status !== "safe" || account.riskLevel !== "normal" || account.profileStatus !== "safe";
}

function isTaskActive(status: string) {
  return ["assigned", "running", "collecting", "captured", "uploading", "structuring", "validating"].includes(status);
}

function readWorkerCdpEndpoints(row: WorkerStatusRow): CdpEndpointRecord[] {
  if (row.cdpEndpoints?.length) return row.cdpEndpoints;
  return row.accounts.map((account) => ({
    endpointId: `${row.worker.workerId}:${account.cdpPort}`,
    workerId: row.worker.workerId,
    host: "127.0.0.1",
    port: account.cdpPort,
    endpointUrl: account.cdpEndpoint || `http://127.0.0.1:${account.cdpPort}`,
    status: account.profileStatus === "profile_risk" ? "profile_risk" : "ready",
    profileId: account.profileId,
    accountId: account.accountId,
    accountDisplayName: account.displayName,
    maskedLogin: account.maskedLogin,
    targetStoreId: account.currentStoreId,
    targetStoreName: account.currentStoreName,
    currentCategoryName: account.currentCategoryName,
    updatedAt: row.worker.lastSeenAt
  }));
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
