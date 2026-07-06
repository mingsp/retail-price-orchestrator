import { useState } from "react";
import type { StoreRecord, StoreRunRecord } from "@retail-orchestrator/shared";

interface Props {
  stores: StoreRecord[];
  runs: StoreRunRecord[];
  onCreateStore: (input: { storeId: string; name: string; url: string; poiIdStr?: string; city?: string; address?: string }) => Promise<void>;
  onCreateRun: (input: { storeId: string; runLabel: string; strategy: "category_split" | "account_rotation" }) => Promise<void>;
  onCreateTasks: (runId: string, categoryNames: string[]) => Promise<void>;
}

export function TaskForms({ stores, runs, onCreateStore, onCreateRun, onCreateTasks }: Props) {
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeUrl, setStoreUrl] = useState("");
  const [poiIdStr, setPoiIdStr] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [runStoreId, setRunStoreId] = useState("");
  const [runLabel, setRunLabel] = useState("");
  const [strategy, setStrategy] = useState<"category_split" | "account_rotation">("category_split");
  const [taskRunId, setTaskRunId] = useState("");
  const [categoryText, setCategoryText] = useState("");

  return (
    <div className="form-grid">
      <form
        className="form-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateStore({
            storeId,
            name: storeName,
            url: storeUrl,
            poiIdStr: poiIdStr || undefined,
            city: city || undefined,
            address: address || undefined
          });
        }}
      >
        <h3>新增门店</h3>
        <input value={storeId} onChange={(event) => setStoreId(event.target.value)} placeholder="storeId" required />
        <input value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="门店名称" required />
        <input value={storeUrl} onChange={(event) => setStoreUrl(event.target.value)} placeholder="门店 H5 URL" required />
        <input value={poiIdStr} onChange={(event) => setPoiIdStr(event.target.value)} placeholder="poi_id_str" />
        <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="城市" />
        <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="地址" />
        <button type="submit">创建门店</button>
      </form>

      <form
        className="form-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateRun({ storeId: runStoreId, runLabel, strategy });
        }}
      >
        <h3>创建批次</h3>
        <select value={runStoreId} onChange={(event) => setRunStoreId(event.target.value)} required>
          <option value="">选择门店</option>
          {stores.map((store) => (
            <option key={store.storeId} value={store.storeId}>
              {store.name}
            </option>
          ))}
        </select>
        <input value={runLabel} onChange={(event) => setRunLabel(event.target.value)} placeholder="批次名称" required />
        <select value={strategy} onChange={(event) => setStrategy(event.target.value as "category_split" | "account_rotation")}>
          <option value="category_split">按类目分工</option>
          <option value="account_rotation">账号轮换</option>
        </select>
        <button type="submit">创建批次</button>
      </form>

      <form
        className="form-panel"
        onSubmit={(event) => {
          event.preventDefault();
          const names = categoryText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          void onCreateTasks(taskRunId, names);
        }}
      >
        <h3>批量类目</h3>
        <select value={taskRunId} onChange={(event) => setTaskRunId(event.target.value)} required>
          <option value="">选择批次</option>
          {runs.map((run) => (
            <option key={run.runId} value={run.runId}>
              {run.runLabel} / {run.storeName || run.storeId}
            </option>
          ))}
        </select>
        <textarea
          value={categoryText}
          onChange={(event) => setCategoryText(event.target.value)}
          placeholder={"每行一个类目\n例如：女性护理\n日用百货"}
          required
        />
        <button type="submit">创建类目任务</button>
      </form>
    </div>
  );
}
