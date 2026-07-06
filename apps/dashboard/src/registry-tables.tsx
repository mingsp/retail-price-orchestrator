import type { AccountRegistryRow, ProfileRegistryRow, RiskEventRecord } from "@retail-orchestrator/shared";
import { labelStatus } from "./display.js";

export function AccountTable({
  accounts,
  onAction
}: {
  accounts: AccountRegistryRow[];
  onAction: (accountId: string, action: "safe" | "cooldown" | "manual_required" | "account_blocked") => void;
}) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>Worker</th>
            <th>状态</th>
            <th>风险</th>
            <th>Profile</th>
            <th>CDP</th>
            <th>当前门店/类目</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.accountId}>
              <td>
                <strong>{account.displayName}</strong>
                <span>{account.accountId}</span>
                {account.maskedLogin ? <span>{account.maskedLogin}</span> : null}
              </td>
              <td>{account.workerId}</td>
              <td>
                <StatusPill status={account.status} />
              </td>
              <td>
                <StatusPill status={account.riskLevel} />
              </td>
              <td>
                <StatusPill status={account.profileStatus} />
                <span>{account.profileId}</span>
              </td>
              <td>{account.cdpPort}</td>
              <td>
                {account.currentStoreName || account.currentStoreId || ""}
                {account.currentCategoryName ? <span>{account.currentCategoryName}</span> : null}
              </td>
              <td>{formatTime(account.updatedAt)}</td>
              <td>
                <div className="actions">
                  <button type="button" onClick={() => onAction(account.accountId, "safe")}>安全</button>
                  <button type="button" onClick={() => onAction(account.accountId, "cooldown")}>冷却</button>
                  <button type="button" onClick={() => onAction(account.accountId, "manual_required")}>需人工</button>
                  <button type="button" onClick={() => onAction(account.accountId, "account_blocked")}>封禁</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <table>
        <thead>
          <tr>
            <th>Profile</th>
            <th>Worker</th>
            <th>绑定账号</th>
            <th>状态</th>
            <th>CDP</th>
            <th>风险次数</th>
            <th>Profile 路径</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={profile.profileId}>
              <td>
                <strong>{profile.profileId}</strong>
              </td>
              <td>{profile.workerId}</td>
              <td>{profile.accountId || ""}</td>
              <td>
                <StatusPill status={profile.status} />
              </td>
              <td>{profile.cdpPort}</td>
              <td>{profile.riskCount}</td>
              <td>{profile.profilePath}</td>
              <td>{formatTime(profile.updatedAt)}</td>
              <td>
                <div className="actions">
                  <button type="button" onClick={() => onAction(profile.profileId, "safe")}>安全</button>
                  <button type="button" onClick={() => onAction(profile.profileId, "profile_risk")}>风险</button>
                  <button type="button" onClick={() => onAction(profile.profileId, "retired")}>停用</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <table>
        <thead>
          <tr>
            <th>风险</th>
            <th>状态</th>
            <th>Worker</th>
            <th>账号/Profile/CDP</th>
            <th>门店/类目</th>
            <th>现象</th>
            <th>建议动作</th>
            <th>创建时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {risks.map((risk) => (
            <tr key={risk.riskId}>
              <td>
                <StatusPill status={risk.severity} />
                <span>{risk.riskType}</span>
              </td>
              <td>
                <StatusPill status={risk.status} />
              </td>
              <td>{risk.workerId}</td>
              <td>
                {risk.accountId || ""}
                {risk.profileId ? <span>{risk.profileId}</span> : null}
                {risk.cdpPort ? <span>CDP {risk.cdpPort}</span> : null}
              </td>
              <td>
                {risk.storeName || risk.storeId || ""}
                {risk.categoryName ? <span>{risk.categoryName}</span> : null}
              </td>
              <td>{risk.observed}</td>
              <td>{risk.recommendedAction}</td>
              <td>{formatTime(risk.createdAt)}</td>
              <td>
                <div className="actions">
                  <button type="button" onClick={() => onAction(risk.riskId, "acknowledged")}>确认</button>
                  <button type="button" onClick={() => onAction(risk.riskId, "resolved")}>解决</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status}`}>{labelStatus(status)}</span>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
