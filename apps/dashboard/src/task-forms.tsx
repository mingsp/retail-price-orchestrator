import { useState } from "react";
import { FolderPlus, Layers, PlusCircle, Store } from "lucide-react";
import type { StoreRecord, StoreRunRecord } from "@retail-orchestrator/shared";

interface Props {
  stores: StoreRecord[];
  runs: StoreRunRecord[];
  onCreateStore: (input: { storeId: string; name: string; url: string; poiIdStr?: string; city?: string; address?: string }) => Promise<void>;
  onCreateRun: (input: { storeId: string; runLabel: string; strategy: "category_split" | "account_rotation" }) => Promise<void>;
  onCreateTasks: (runId: string, rows: Array<{ categoryName: string; categoryTag?: string; expectedItems?: number }>) => Promise<void>;
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <form
        className="glass-panel rounded-2xl p-6 space-y-4 shadow-sm transition hover:border-slate-300"
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
          setStoreId("");
          setStoreName("");
          setStoreUrl("");
          setPoiIdStr("");
          setCity("");
          setAddress("");
        }}
      >
        <div className="flex items-center gap-3 pb-3 border-b border-slate-200/80">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-base font-bold text-slate-900 tracking-tight">新增竞对门店</h3>
            <p className="mt-0.5 text-xs text-slate-500">录入美团或饿了么目标门店及基础元信息</p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <FieldGroup label="门店全局唯一编码 (Store ID) *">
            <input
              className="form-input"
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              placeholder="例如: store_guagua_01"
              required
            />
          </FieldGroup>
          <FieldGroup label="门店展示名称 *">
            <input
              className="form-input"
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              placeholder="例如: 呱呱鲜果（南门总店）"
              required
            />
          </FieldGroup>
          <FieldGroup label="门店 H5/App 入口链接 URL *">
            <input
              className="form-input"
              value={storeUrl}
              onChange={(event) => setStoreUrl(event.target.value)}
              placeholder="https://..."
              required
            />
          </FieldGroup>
          <FieldGroup label="POI ID 字符串（可选）">
            <input
              className="form-input"
              value={poiIdStr}
              onChange={(event) => setPoiIdStr(event.target.value)}
              placeholder="门店平台 POI 标识"
            />
          </FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="城市（可选）">
              <input
                className="form-input"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="例如: 杭州"
              />
            </FieldGroup>
            <FieldGroup label="地址（可选）">
              <input
                className="form-input"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="具体路段或商圈"
              />
            </FieldGroup>
          </div>
        </div>

        <button type="submit" className="primary-action w-full justify-center !py-2.5 mt-2 rounded-xl text-xs font-bold shadow-sm">
          <PlusCircle className="h-4 w-4" />
          <span>立即建档门店</span>
        </button>
      </form>

      <form
        className="glass-panel rounded-2xl p-6 space-y-4 shadow-sm transition hover:border-slate-300"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateRun({ storeId: runStoreId, runLabel, strategy });
          setRunLabel("");
        }}
      >
        <div className="flex items-center gap-3 pb-3 border-b border-slate-200/80">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60">
            <FolderPlus className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-base font-bold text-slate-900 tracking-tight">创建采集计划批次</h3>
            <p className="mt-0.5 text-xs text-slate-500">将门店下发为具体轮次与并发调度策略</p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <FieldGroup label="选择目标门店 *">
            <select className="form-input font-semibold" value={runStoreId} onChange={(event) => setRunStoreId(event.target.value)} required>
              <option value="">请选择门店...</option>
              {stores.map((store) => (
                <option key={store.storeId} value={store.storeId}>
                  {store.name} ({store.storeId})
                </option>
              ))}
            </select>
          </FieldGroup>
          <FieldGroup label="批次标签/编号 *">
            <input
              className="form-input"
              value={runLabel}
              onChange={(event) => setRunLabel(event.target.value)}
              placeholder="例如: 2026-07 早市比价批次"
              required
            />
          </FieldGroup>
          <FieldGroup label="任务分发与并发策略 *">
            <select
              className="form-input font-semibold"
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as "category_split" | "account_rotation")}
            >
              <option value="category_split">按类目并发切片 (Category Split - 推荐)</option>
              <option value="account_rotation">账号轮换采集 (Account Rotation)</option>
            </select>
          </FieldGroup>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-3.5 text-[11px] leading-relaxed text-slate-600 font-medium">
          按类目并发切片将为每个一级或二级分类自动生成独立任务单元，可跨多个设备和账号自动并列抓取。
        </div>

        <button type="submit" className="primary-action w-full justify-center !py-2.5 mt-2 rounded-xl text-xs font-bold shadow-sm">
          <FolderPlus className="h-4 w-4" />
          <span>生成计划批次</span>
        </button>
      </form>

      <form
        className="glass-panel rounded-2xl p-6 space-y-4 shadow-sm transition hover:border-slate-300"
        onSubmit={(event) => {
          event.preventDefault();
          const rows = categoryText.split(/\r?\n/).map(parseCategoryLine).filter((row) => row.categoryName);
          void onCreateTasks(taskRunId, rows);
          setCategoryText("");
        }}
      >
        <div className="flex items-center gap-3 pb-3 border-b border-slate-200/80">
          <div className="rounded-xl bg-slate-100 p-2.5 text-slate-800 border border-slate-200/60">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="m-0 text-base font-bold text-slate-900 tracking-tight">批量导入类目切片</h3>
            <p className="mt-0.5 text-xs text-slate-500">为目标批次一键灌入需要巡检的类目清单</p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <FieldGroup label="归属计划批次 *">
            <select className="form-input font-semibold" value={taskRunId} onChange={(event) => setTaskRunId(event.target.value)} required>
              <option value="">请选择采集批次...</option>
              {runs.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {run.runLabel} · [{run.storeName || run.storeId}]
                </option>
              ))}
            </select>
          </FieldGroup>
          <FieldGroup label="类目配置清单 (每行一个类目) *">
            <textarea
              className="form-input min-h-[148px] font-mono text-xs leading-5"
              value={categoryText}
              onChange={(event) => setCategoryText(event.target.value)}
              placeholder={"每行一个；格式支持：类目名|标签|预估SKU数\n\n例如：\n新鲜水果|fruit_top|180\n日用百货|daily|320\n休闲零食"}
              required
            />
          </FieldGroup>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200/60 p-3.5 text-[11px] leading-relaxed text-slate-600 font-medium">
          多列配置可以用竖线 <code>|</code> 分隔。预估 SKU 数仅用于容量规划；完成度只按通过完整性校验的类目计算。
        </div>

        <button type="submit" className="primary-action w-full justify-center !py-2.5 mt-2 rounded-xl text-xs font-bold shadow-sm">
          <Layers className="h-4 w-4" />
          <span>批量创建切片任务</span>
        </button>
      </form>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-700 block">{label}</span>
      {children}
    </label>
  );
}

function parseCategoryLine(line: string): { categoryName: string; categoryTag?: string; expectedItems?: number } {
  const [categoryName = "", categoryTag = "", expectedText = ""] = line.split("|").map((part) => part.trim());
  const expectedItems = Number(expectedText);
  return {
    categoryName,
    categoryTag: categoryTag || undefined,
    expectedItems: Number.isFinite(expectedItems) && expectedItems > 0 ? expectedItems : undefined
  };
}
