import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ArtifactRecord, PriceQualityRecord, ProductDataQualityGate, ProductSnapshotSummary } from "@retail-orchestrator/shared";
import { formatNumber, StatusPill } from "./display.js";
import { PaginationControls } from "./pagination-controls.js";
import { slicePage } from "./pagination.js";

export function ArtifactTable({
  artifacts,
  qualityChecks,
  productSummary,
  productQualityGate
}: {
  artifacts: ArtifactRecord[];
  qualityChecks: PriceQualityRecord[];
  productSummary: ProductSnapshotSummary;
  productQualityGate: ProductDataQualityGate | null;
}) {
  const [artifactPage, setArtifactPage] = useState(1);
  const [qualityPage, setQualityPage] = useState(1);
  const artifactRows = slicePage(artifacts, artifactPage, 30);
  const qualityRows = slicePage(qualityChecks, qualityPage, 30);

  return (
    <div className="space-y-6 md:space-y-8">
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <SummaryCard label="当前有效商品 (SPU)" value={productSummary.productCount} hint="当前生产批次中已通过类目校验的去重商品" />
        <SummaryCard label="当前有效 SKU" value={productSummary.skuCount} hint="当前生产批次中已通过类目校验的规格记录" />
        <SummaryCard label="页面前端展示价覆盖" value={productSummary.frontDisplayPriceCount} hint={coverage(productSummary.frontDisplayPriceCount, productSummary.productCount + productSummary.skuCount)} />
        <SummaryCard label="实际计算到手价覆盖" value={productSummary.userFinalPriceCount} hint={coverage(productSummary.userFinalPriceCount, productSummary.productCount + productSummary.skuCount)} />
      </section>

      {productQualityGate ? (
        <section className={`glass-panel rounded-2xl border p-6 transition shadow-sm ${productQualityGate.businessExportAllowed ? "border-emerald-200/80 bg-emerald-50/20" : "border-rose-200/80 bg-rose-50/20"}`}>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <div className={`rounded-xl p-2.5 border ${productQualityGate.businessExportAllowed ? "bg-emerald-100/80 text-emerald-800 border-emerald-200" : "bg-rose-100/80 text-rose-800 border-rose-200"}`}>
                  {productQualityGate.businessExportAllowed ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="m-0 text-base md:text-lg font-bold text-slate-900 tracking-tight">价格数据完整性校验</h2>
                    <StatusPill status={productQualityGate.businessExportAllowed ? "ready" : "failed"} />
                  </div>
                  <p className="mt-1 text-xs font-medium text-slate-500">{productQualityGate.reason}</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 shrink-0">
              <GateMetric label="页面价完整率" value={`${Math.round(productQualityGate.frontDisplayPriceCoverage * 100)}%`} tone={productQualityGate.frontDisplayPriceCoverage === 1 ? "green" : "red"} />
              <GateMetric label="页面价缺失" value={formatNumber(productQualityGate.missingFrontDisplayPriceCount)} tone={productQualityGate.missingFrontDisplayPriceCount > 0 ? "red" : "green"} />
              <GateMetric label="优惠到手价覆盖" value={`${Math.round(productQualityGate.userFinalPriceCoverage * 100)}%`} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="table-shell">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">原始数据归档中心</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">完整保留每次采集的商品原始数据、进度记录和异常现场</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            共 {artifacts.length} 个文件
          </span>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>产物类型 / ID</th>
                <th>文件信息</th>
                <th>归属任务链路</th>
                <th>来源账号 / Profile</th>
                <th>数据大小</th>
                <th>归档时间</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.length ? (
                artifactRows.items.map((artifact) => (
                  <tr key={artifact.artifactId}>
                    <td>
                      <div className="flex flex-col gap-1 items-start">
                        <StatusPill status={artifact.kind} />
                        <span className="font-mono text-[11px] text-slate-400 font-medium mt-0.5">{compressId(artifact.artifactId)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 min-w-[180px]">
                        <span className="text-xs font-bold text-slate-800">已安全归档</span>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>原始数据可追溯</span>
                          {artifact.contentType ? <span>· {formatContentType(artifact.contentType)}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="font-bold text-slate-800">{artifact.storeId || "-"}</span>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {artifact.runId ? <span>Run: {compressId(artifact.runId)} </span> : null}
                          {artifact.taskId ? <span>Task: {compressId(artifact.taskId)}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="font-semibold text-slate-700">{artifact.accountId || "-"}</span>
                        {artifact.profileId ? <span className="text-[11px] text-slate-400 font-mono">{artifact.profileId}</span> : null}
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-xs font-semibold text-slate-700">{formatBytes(artifact.sizeBytes)}</span>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-slate-500">{formatTime(artifact.createdAt)}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-xs text-slate-400 font-medium">暂无抓取归档产物文件上报</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls {...artifactRows} onPageChange={setArtifactPage} />
      </section>

      <section className="table-shell">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/50">
          <div>
            <h3 className="m-0 text-sm font-bold text-slate-900">到手价与字段完整度自动化检查记录</h3>
            <p className="mt-0.5 text-xs text-slate-500 font-medium">评估每个 RAW 产物中 SPUs/SKUs 的字段完整性与有效到手价提取率</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-200/60 px-2.5 py-0.5 text-xs font-bold text-slate-700">
            {qualityChecks.length} 条检测
          </span>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>质量结论 / ID</th>
                <th>关联门店及产物</th>
                <th>抓取原始规模</th>
                <th>展示价覆盖率</th>
                <th>SKU 到手价覆盖</th>
                <th>辅助标签与信息</th>
                <th>审计校验时间</th>
              </tr>
            </thead>
            <tbody>
              {qualityChecks.length ? (
                qualityRows.items.map((quality) => (
                  <tr key={quality.qualityId}>
                    <td>
                      <div className="flex flex-col gap-1 items-start">
                        <StatusPill status={quality.completenessStatus} />
                        <span className="font-mono text-[11px] text-slate-400 font-medium mt-0.5">{compressId(quality.qualityId)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 text-xs">
                        <span className="font-bold text-slate-800">{quality.storeId || "-"}</span>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {quality.runId ? <span>Run: {compressId(quality.runId)} </span> : null}
                          {quality.artifactId ? <span>Artifact: {compressId(quality.artifactId)}</span> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-col gap-0.5 text-xs font-mono">
                        <span className="font-bold text-slate-800">{formatNumber(quality.rawRows)} 行 RAW</span>
                        <div className="text-[11px] text-slate-500">
                          <span>SPU: {formatNumber(quality.uniqueSpuCount)}</span> · <span>SKU: {formatNumber(quality.skuRows)}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-xs font-bold text-slate-800">{coverage(quality.frontDisplayPricePresent, quality.rawRows)}</span>
                    </td>
                    <td>
                      <span className="font-mono text-xs font-bold text-indigo-600">{coverage(quality.skuFrontDisplayPricePresent, quality.skuRows)}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1 text-[11px] font-medium text-slate-600 max-w-xs">
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/60">原价: {quality.actualPriceInfoPresent}</span>
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/60">促销: {quality.promotionInfoPresent}</span>
                        <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/60">动态标签: {quality.dynamicLabelPresent}</span>
                        {quality.duplicateSpuCount > 0 ? <span className="bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded border border-rose-200">重复 SPU: {quality.duplicateSpuCount}</span> : null}
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-xs text-slate-500">{formatTime(quality.checkedAt)}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-xs text-slate-400 font-medium">暂无数据质量检查报告上报</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <PaginationControls {...qualityRows} onPageChange={setQualityPage} />
      </section>
    </div>
  );
}

function GateMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "green" | "red" }) {
  const toneClass = tone === "green" ? "text-emerald-700 bg-emerald-50/60 border-emerald-200" : tone === "red" ? "text-rose-700 bg-rose-50/60 border-rose-200" : "text-slate-900 bg-white border-slate-200/80";
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 text-right shadow-sm ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{label}</div>
      <div className="mt-1 text-xl font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="glass-panel rounded-2xl p-5 md:p-6 transition hover:border-slate-300">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 font-mono">{formatNumber(value)}</div>
      <div className="mt-1.5 text-xs font-medium text-slate-500">{hint}</div>
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

function coverage(value: number, total: number) {
  if (!total || total <= 0) return "-";
  const percent = Math.round((value / total) * 100);
  return `${formatNumber(value)}/${formatNumber(total)} (${percent}%)`;
}

function formatBytes(bytes?: number) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i] || "B"}`;
}

function formatContentType(value: string): string {
  if (value.includes("json")) return "结构化文本";
  if (value.includes("image")) return "图片";
  if (value.includes("html")) return "页面记录";
  return "数据文件";
}

function compressId(value: string) {
  if (!value || value.length <= 14) return value || "-";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
