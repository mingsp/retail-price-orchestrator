# Master-Workers 数据完整采集临时方案

更新日期：2026-07-10

## 0. 实施状态

本方案对应的系统实现与自动化验证已于 2026-07-10 完成。生产证据、历史数据重放结果、故障恢复结果和当前运行态门禁见：

- `docs/production-verification-20260710.md`

当前禁止把旧批次直接视为完整结果。下一步真实开采必须新建批次，并在 Worker、账号、Profile、CDP、门店五元绑定通过生产就绪检查后启动。

> 2026-07-10 后续决策：原“采集工作台 + 系统管理”双外壳已合并为单一采集生产工作台。业务信息优先展示，设备、账号、浏览器席位和诊断能力仍在同一导航内按需进入。

## 1. 目标与优先级

本轮工作的唯一主目标是：让 Master 能够稳定调度多个 Worker，以固定账号、固定 Profile、固定 CDP 和固定类目分工完成门店全量采集，并产出可追溯、可校验、可恢复的数据资产。

优先级从高到低：

1. 数据真实性与完整性。
2. Master-Worker 调度正确性与断点恢复。
3. 采集过程可观测、可人工介入。
4. 业务工作台的信息降噪。
5. 最小化的内部权限边界。

本轮不建设复杂 RBAC，也不把价格洞察当作主屏。比价分析属于采集完成后的下游能力。

## 2. “完整采集”的验收定义

一次门店批次只有同时满足以下条件，才允许显示“已完成”：

- 批次中的全部类目都处于 `completed_valid`，或处于经过人工确认的 `skipped_approved`。
- 每个任务都有原始 JSONL、断点文件、摘要文件和 SHA-256 校验值。
- 原始有效商品行全部完成结构化；失败行有独立错误记录，不能静默丢失。
- `store_run_id`、`task_id`、`store_id`、`artifact_id` 关联率为 100%。
- 同一批次内按门店、SPU、SKU 去重后不存在重复事实行；跨类目归属单独保存。
- 前端展示价和真实用户到手价分开保存；没有真实证据时，到手价必须为空。
- 任务完成前已通过数据质量门禁，且门禁结果绑定到本次批次和原始产物。
- Worker 中断、Master 重启、Redis 或 S3 短时故障后可以从断点幂等恢复。

## 3. 当前阻断问题

### 3.1 数据真实性

- 用户到手价在缺少真实价格证据时被前端展示价回填，造成 100% 假覆盖。
- 商品快照使用采集进程 ID 代替业务批次 ID，无法关联 `store_runs`。
- 同一商品跨类目重复写入商品事实表。
- 质量报告没有稳定生成，但页面仍可能显示绿色门禁。

### 3.2 任务状态

- Worker 在原始产物上传、结构化入库和质量检查之前标记任务完成。
- `category_done` 进度事件会提前把任务改成 `completed`。
- StoreRun 没有根据任务状态自动聚合，出现批次仍为“已计划”但任务已大量完成。
- 租约没有 fencing token，网络分区时旧 Worker 可能覆盖新 Worker 的进度。

### 3.3 资源绑定与恢复

- Master 领取任务时没有强制验证 Worker、账号、Profile、CDP、门店五元绑定。
- 心跳快照为空时可能删除账号、Profile 和 CDP 资源。
- S3 或结构化入库失败只打印警告，不阻断完成状态。

### 3.4 操作台

- 业务工作台直接暴露 Worker、CDP、Profile、路径和请求错误。
- “今日”指标实际统计历史全量数据。
- 500 个产物和 120 个类目一次性渲染，缺少分页和按需展开。
- 实时日志应保留，但必须转换为门店、类目、商品数、进度和待处理事项等业务活动。

## 4. 目标架构

保持一个 monorepo，形成以下可独立运行的模块：

- Dashboard：一个前端工程和一个系统入口，统一承载采集进度、调度、资源、风控、数据结果和审计。
- Business API：只输出门店、批次、类目、进度、业务活动、异常和交付结果。
- Admin API：输出设备、账号、Profile、CDP、技术日志和原始产物。
- Scheduler：以 PostgreSQL 为任务事实源，使用 fenced lease 保证单任务单执行者。
- Worker Gateway：接收心跳、进度、风险、产物和质量结果。
- Ingestion Pipeline：原始数据校验、结构化、去重、质量门禁和业务导出。
- PostgreSQL：编排状态、结构化快照、质量报告和操作事件。
- Redis：异步事件和短期协调；不可作为唯一事实源。
- MinIO/S3：原始 JSONL、断点、摘要、截图和导出文件。

## 5. 任务状态与业务映射

后端状态：

```text
pending -> assigned -> collecting
collecting -> manual_required | cooldown | captured | failed
captured -> uploading -> structuring -> validating
validating -> completed_valid | needs_review | failed
```

统一工作台的首页和进度页优先显示：

| 后端状态 | 业务状态 |
|---|---|
| pending / assigned | 等待采集 |
| collecting | 采集中 |
| manual_required | 需要人工处理 |
| cooldown | 暂缓，稍后继续 |
| captured / uploading / structuring / validating | 数据处理中 |
| completed_valid | 已完成 |
| needs_review | 数据待确认 |
| failed | 采集未完成 |

## 6. 数据资产设计

- `store_run_id` 使用 UUID 外键，采集进程使用独立 `capture_id`。
- 商品事实唯一键：`store_run_id + store_id + spu_id`。
- SKU 事实唯一键：`store_run_id + store_id + spu_id + sku_id`。
- 类目归属使用独立关系表，不把类目放入商品事实唯一键。
- `front_display_price_*` 只表示页面展示价。
- `user_final_price_*` 只在存在 `actual_price_info` 或明确等价证据时写入。
- 新增 `user_final_price_source_path` 和 `price_semantics`，保留价格来源语义。
- 结构化失败进入 `ingestion_errors`，包含 artifact、任务、行号、原因和原始摘要。

## 7. 故障处理

- Worker 失联：停止本地采集写回；租约过期后由 Master 回收，旧 fencing token 永久失效。
- Redis 失效：停止新异步任务，PostgreSQL outbox 保留待处理事件，恢复后重放。
- S3 失效：Worker 本地 spool，任务停留在 `uploading`，不得完成。
- PostgreSQL 失效：Worker 保存断点并暂停，不领取新任务。
- RetailMart 失效：采集和归档可完成，业务入库标记为待同步。
- 外部渠道异常：仅暂停受影响的账号、门店或类目，其它固定分工继续执行。

## 8. 前端信息架构

### 8.1 统一采集工作台

- 采集总览：今日批次、门店进度、采集商品数、数据完整度、待处理事项。
- 门店任务：创建批次、查看类目分工、启动、暂停、恢复。
- 实时进度：按门店和类目展示业务活动流，不展示原始技术日志。
- 异常处理：展示门店、类目、账号槽位、截图和建议动作。
- 数据结果：展示完整度、真实到手价覆盖、导出状态和业务文件。
- 采集设备：设备与浏览器席位的在线状态、账号和门店绑定。
- 账号与浏览器：账号、Profile、CDP 的必要识别信息；不展示本机路径和长 URL。
- 原始数据与审计：原始产物、调度状态和操作记录；底层路径只保留在诊断日志。

## 9. 完成标准

- 所有新增行为有失败测试和通过测试。
- Master、Worker、Shared、Dashboard 类型检查通过。
- Master 和 Worker 自动化测试全部通过。
- 用历史原始数据执行一次只读重放，证明批次关联、真实到手价和去重口径正确。
- 浏览器验证两个工作台、关键操作、分页、空态、错误态和实时业务活动。
- 输出生产就绪报告，列出已通过项和仍依赖真实账号采集才能验证的项目。
