import type { ArtifactRecord } from "@retail-orchestrator/shared";
import { labelStatus } from "./display.js";

export function ArtifactTable({ artifacts }: { artifacts: ArtifactRecord[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>产物</th>
            <th>对象</th>
            <th>归属</th>
            <th>账号/Profile</th>
            <th>大小</th>
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((artifact) => (
            <tr key={artifact.artifactId}>
              <td>
                <StatusPill status={artifact.kind} />
                <span>{artifact.artifactId}</span>
              </td>
              <td>
                <strong>{artifact.bucket}</strong>
                <span>{artifact.objectKey}</span>
                {artifact.contentType ? <span>{artifact.contentType}</span> : null}
              </td>
              <td>
                {artifact.storeId || ""}
                {artifact.runId ? <span>{artifact.runId}</span> : null}
                {artifact.taskId ? <span>{artifact.taskId}</span> : null}
                {artifact.workerId ? <span>{artifact.workerId}</span> : null}
              </td>
              <td>
                {artifact.accountId || ""}
                {artifact.profileId ? <span>{artifact.profileId}</span> : null}
              </td>
              <td>{artifact.sizeBytes ?? ""}</td>
              <td>{formatTime(artifact.createdAt)}</td>
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
    minute: "2-digit"
  }).format(new Date(value));
}
