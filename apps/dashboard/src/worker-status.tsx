import type { WorkerStatusRow } from "@retail-orchestrator/shared";
import { labelStatus } from "./display.js";

interface Props {
  workers: WorkerStatusRow[];
}

export function WorkerStatusTable({ workers }: Props) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Worker ID</th>
            <th>机器</th>
            <th>状态</th>
            <th>最后心跳</th>
            <th>账号</th>
            <th>Profile</th>
            <th>CDP</th>
            <th>当前任务</th>
            <th>日志摘要</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((row) => {
            const accounts = row.accounts.length ? row.accounts : [undefined];
            return accounts.map((account, index) => (
              <tr key={`${row.worker.workerId}-${account?.accountId || "empty"}-${index}`}>
                {index === 0 ? (
                  <>
                    <td rowSpan={accounts.length}>
                      <strong>{row.worker.workerId}</strong>
                      <span>{row.worker.hostname}</span>
                    </td>
                    <td rowSpan={accounts.length}>{row.worker.machineLabel}</td>
                    <td rowSpan={accounts.length}>
                      <StatusPill status={row.worker.status} />
                    </td>
                    <td rowSpan={accounts.length}>{formatTime(row.worker.lastSeenAt)}</td>
                  </>
                ) : null}
                <td>
                  {account ? (
                    <>
                      <strong>{account.displayName}</strong>
                      <span>{account.accountId}</span>
                      {account.maskedLogin ? <span>{account.maskedLogin}</span> : null}
                    </>
                  ) : (
                    <span className="muted">未上报账号</span>
                  )}
                </td>
                <td>
                  {account ? (
                    <>
                      <StatusPill status={account.profileStatus} />
                      <span>{account.profileId}</span>
                    </>
                  ) : null}
                </td>
                <td>{account?.cdpPort || ""}</td>
                <td>
                  {account?.currentStoreName || account?.currentStoreId || ""}
                  {account?.currentCategoryName ? <span>{account.currentCategoryName}</span> : null}
                </td>
                {index === 0 ? <td rowSpan={accounts.length}>{row.worker.latestLogSummary || ""}</td> : null}
              </tr>
            ));
          })}
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
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}
