import { CalendarClock, Pencil, Plus, Search, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  AccountPoolRecord,
  AccountPoolStatus,
  CreateAccountPoolInput,
  UpdateAccountPoolInput
} from "@retail-orchestrator/shared";
import { StatusPill } from "./display.js";

interface Props {
  accounts: AccountPoolRecord[];
  onCreate: (input: CreateAccountPoolInput) => Promise<void>;
  onUpdate: (accountId: string, input: UpdateAccountPoolInput) => Promise<void>;
}

const statusOptions: Array<{ value: AccountPoolStatus | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "available", label: "可用" },
  { value: "reserved", label: "已预留" },
  { value: "in_use", label: "使用中" },
  { value: "cooldown", label: "冷却中" },
  { value: "risk", label: "风险" },
  { value: "retired", label: "已停用" }
];

export function AccountPoolTable({ accounts, onCreate, onUpdate }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AccountPoolStatus | "all">("all");
  const [editing, setEditing] = useState<AccountPoolRecord | "new" | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (status !== "all" && account.status !== status) return false;
      if (!needle) return true;
      return [account.displayName, account.maskedLogin, account.operatorOwner, account.currentStoreName]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [accounts, query, status]);

  const available = accounts.filter((account) => account.status === "available").length;
  const cooling = accounts.filter((account) => account.status === "cooldown").length;
  const risk = accounts.filter((account) => account.status === "risk" || account.riskLevel === "blocked").length;

  async function setLifecycle(account: AccountPoolRecord, next: AccountPoolStatus) {
    const update: UpdateAccountPoolInput = {
      status: next,
      riskLevel: next === "risk" ? "blocked" : next === "cooldown" ? "watch" : "normal"
    };
    if (next === "cooldown") {
      update.availableAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    } else if (next === "available") {
      update.availableAfter = null;
    }
    await onUpdate(account.accountId, update);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PoolMetric label="账号总数" value={accounts.length} icon={<UserRoundCheck className="h-5 w-5" />} />
        <PoolMetric label="当前可用" value={available} icon={<ShieldCheck className="h-5 w-5" />} tone="healthy" />
        <PoolMetric label="冷却中" value={cooling} icon={<CalendarClock className="h-5 w-5" />} tone="warning" />
        <PoolMetric label="风险账号" value={risk} icon={<ShieldCheck className="h-5 w-5" />} tone="danger" />
      </div>

      <div className="table-shell">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
          <div>
            <h3 className="m-0 text-base font-bold text-slate-900">采集账号池</h3>
            <p className="mt-1 text-sm text-slate-500">统一记录账号归属、使用周期、门店任务和风险状态</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="relative min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="form-input !pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号、归属人或门店" />
            </label>
            <select className="form-input min-w-[130px]" value={status} onChange={(event) => setStatus(event.target.value as AccountPoolStatus | "all")}>
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button className="primary-action" type="button" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" />登记账号
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>归属人</th>
                <th>状态</th>
                <th>上次使用</th>
                <th>再次可用</th>
                <th>当前安排</th>
                <th>使用 / 风险</th>
                <th>备注</th>
                <th className="text-right">维护</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? filtered.map((account) => (
                <tr key={account.accountId}>
                  <td>
                    <div className="flex flex-col gap-1 min-w-[130px]">
                      <strong className="text-sm text-slate-900">{account.displayName}</strong>
                      <span className="font-mono text-xs text-slate-500">{account.maskedLogin}</span>
                    </div>
                  </td>
                  <td><span className="text-sm font-semibold text-slate-700">{account.operatorOwner}</span></td>
                  <td><StatusPill status={account.status} /></td>
                  <td><TimeCell value={account.lastUsedAt} empty="尚未采集" /></td>
                  <td>
                    {account.status === "cooldown" ? <TimeCell value={account.availableAfter} empty="待人工确认" /> : <span className="text-sm text-slate-500">当前可安排</span>}
                  </td>
                  <td>
                    <div className="flex flex-col gap-1 min-w-[140px]">
                      <span className="text-sm font-semibold text-slate-800">{account.currentStoreName || "未分配门店"}</span>
                      <span className="text-xs text-slate-500">{account.currentCategoryName || account.assignedWorkerLabel || "未绑定设备"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex gap-3 text-sm">
                      <span><strong>{account.useCount}</strong> 次</span>
                      <span className={account.riskCount ? "text-rose-600" : "text-slate-500"}><strong>{account.riskCount}</strong> 风险</span>
                    </div>
                  </td>
                  <td><span className="block max-w-[180px] truncate text-sm text-slate-500" title={account.note}>{account.note || "-"}</span></td>
                  <td>
                    <div className="flex justify-end gap-1.5 min-w-[250px]">
                      <button className="mini-action" type="button" title="编辑账号" onClick={() => setEditing(account)}><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="mini-action" type="button" onClick={() => setLifecycle(account, "available")}>可用</button>
                      <button className="mini-action" type="button" onClick={() => setLifecycle(account, "reserved")}>预留</button>
                      <button className="mini-action" type="button" onClick={() => setLifecycle(account, "cooldown")}>冷却</button>
                      <button className="mini-action danger" type="button" onClick={() => setLifecycle(account, "risk")}>风险</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={9} className="text-center py-12 text-sm text-slate-400">暂无符合条件的账号记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <AccountEditor
          account={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing === "new") await onCreate(input);
            else await onUpdate(editing.accountId, input);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PoolMetric({ label, value, icon, tone = "neutral" }: { label: string; value: number; icon: ReactNode; tone?: "neutral" | "healthy" | "warning" | "danger" }) {
  return (
    <div className={`pool-metric pool-metric-${tone}`}>
      <span className="pool-metric-icon">{icon}</span>
      <div><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-bold text-slate-900">{value}</div></div>
    </div>
  );
}

function TimeCell({ value, empty }: { value?: string; empty: string }) {
  if (!value) return <span className="text-sm text-slate-400">{empty}</span>;
  const date = new Date(value);
  return <span className="text-sm text-slate-600 whitespace-nowrap">{Number.isNaN(date.getTime()) ? empty : date.toLocaleString("zh-CN", { hour12: false })}</span>;
}

function AccountEditor({ account, onClose, onSave }: {
  account?: AccountPoolRecord;
  onClose: () => void;
  onSave: (input: CreateAccountPoolInput) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(account?.displayName || "");
  const [maskedLogin, setMaskedLogin] = useState(account?.maskedLogin || "");
  const [operatorOwner, setOperatorOwner] = useState(account?.operatorOwner || "");
  const [note, setNote] = useState(account?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!displayName.trim() || !maskedLogin.trim() || !operatorOwner.trim()) {
      setError("请完整填写账号名称、脱敏手机号和归属人");
      return;
    }
    if (/^\d{7,}$/.test(maskedLogin.trim())) {
      setError("请填写脱敏手机号，例如 138****5678");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSave({ displayName: displayName.trim(), maskedLogin: maskedLogin.trim(), operatorOwner: operatorOwner.trim(), note: note.trim() || undefined });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="account-editor" onSubmit={submit}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div><h3 className="m-0 text-lg font-bold text-slate-900">{account ? "编辑账号" : "登记账号"}</h3><p className="mt-1 text-sm text-slate-500">只登记账号身份和使用状态，不保存密码、验证码或 Cookie</p></div>
          <button className="icon-action" type="button" title="关闭" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-4 px-6 py-5">
          <Field label="账号名称"><input className="form-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：账号 A01" autoFocus /></Field>
          <Field label="脱敏手机号"><input className="form-input" value={maskedLogin} onChange={(event) => setMaskedLogin(event.target.value)} placeholder="例如：138****5678" /></Field>
          <Field label="账号归属人"><input className="form-input" value={operatorOwner} onChange={(event) => setOperatorOwner(event.target.value)} placeholder="负责登录和处理验证的同事" /></Field>
          <Field label="备注"><textarea className="form-input min-h-[88px] resize-y" value={note} onChange={(event) => setNote(event.target.value)} placeholder="仅记录必要的业务说明" /></Field>
          {error ? <div className="action-error !m-0">{error}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button className="secondary-action" type="button" onClick={onClose}>取消</button>
          <button className="primary-action" type="submit" disabled={saving}>{saving ? "保存中..." : "保存账号"}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>;
}
