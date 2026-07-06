import type { CategoryTaskRecord, StoreRecord, StoreRunRecord } from "@retail-orchestrator/shared";

export function StoreTable({ stores }: { stores: StoreRecord[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>门店</th>
            <th>平台</th>
            <th>状态</th>
            <th>POI</th>
            <th>城市/地址</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => (
            <tr key={store.storeId}>
              <td>
                <strong>{store.name}</strong>
                <span>{store.storeId}</span>
              </td>
              <td>{store.platform}</td>
              <td>
                <StatusPill status={store.status} />
              </td>
              <td>{store.poiIdStr || ""}</td>
              <td>
                {store.city || ""}
                {store.address ? <span>{store.address}</span> : null}
              </td>
              <td>{formatTime(store.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunTable({ runs }: { runs: StoreRunRecord[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>批次</th>
            <th>门店</th>
            <th>状态</th>
            <th>策略</th>
            <th>目标完成</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.runId}>
              <td>
                <strong>{run.runLabel}</strong>
                <span>{run.runId}</span>
              </td>
              <td>
                {run.storeName || run.storeId}
                <span>{run.storeId}</span>
              </td>
              <td>
                <StatusPill status={run.status} />
              </td>
              <td>{run.strategy}</td>
              <td>{run.targetFinishAt ? formatTime(run.targetFinishAt) : ""}</td>
              <td>{formatTime(run.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TaskTable({ tasks }: { tasks: CategoryTaskRecord[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>类目任务</th>
            <th>门店</th>
            <th>状态</th>
            <th>分配</th>
            <th>采集数</th>
            <th>游标</th>
            <th>错误</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.taskId}>
              <td>
                <strong>{task.categoryName}</strong>
                <span>order {task.categoryOrder} / priority {task.priority}</span>
                <span>{task.taskId}</span>
              </td>
              <td>
                {task.storeName || task.storeId}
                <span>{task.runId}</span>
              </td>
              <td>
                <StatusPill status={task.status} />
              </td>
              <td>
                {task.assignedWorkerId || ""}
                {task.assignedAccountId ? <span>{task.assignedAccountId}</span> : null}
                {task.assignedProfileId ? <span>{task.assignedProfileId}</span> : null}
              </td>
              <td>
                {task.collectedItems}
                {task.expectedItems ? <span>expected {task.expectedItems}</span> : null}
              </td>
              <td>{JSON.stringify(task.cursor)}</td>
              <td>{task.lastError || ""}</td>
              <td>{formatTime(task.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${status}`}>{status}</span>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
