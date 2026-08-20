# 数据目录、归档与 Excel 交付

## 1. 第一原则

原始数据是可重放的来源事实，Excel 和数据库业务表是派生结果。部署代码时不迁移历史 JSONL；采集任务只能通过正式产物链把新数据写入所属 Master。

## 2. Worker 本地目录

Native Collector 当前使用以下稳定分区：

```text
<WORKER_NATIVE_OUTPUT_ROOT>/
  <storeId>/
    <runId>/
      <taskId>/
        <captureId>.products.raw.jsonl
        <captureId>.categories.jsonl
        <captureId>.progress.jsonl
        <captureId>.checkpoint.json
        <captureId>.summary.json
```

含义：

- `storeId`：门店边界，禁止跨门店混放。
- `runId`：一次业务采集批次，对应采集日期和冻结范围。
- `taskId`：一个类目任务；类目名称以 Master 任务记录为准。
- `captureId`：一次采集尝试；纠错重试使用新 ID，断点恢复可引用旧 capture。

禁止把所有 JSONL 平铺到桌面或同一个日期文件。禁止因同一 SPU 出现在多个类目就跨类目去重。

## 3. Master 原始资产

Worker 上传后的对象键保持同一业务层级：

```text
raw-artifacts/<storeId>/<runId>/<taskId>/<workerRunId>-<sourceFile>
```

每个 artifact 必须同时保存：Worker、账号、Profile、任务、门店、SHA-256、文件大小、对象 versionId 和创建时间。数据库只保存索引和结构化事实，MinIO 保存原始文件本体。

截图、日志和导出文件使用独立 bucket；不得把它们混进商品 JSONL。

## 4. 归档完成条件

一个类目只有同时满足以下条件才能标记 `completed_valid`：

1. 原始商品 JSONL 与类目证据已上传。
2. checkpoint、summary 和质量结果可读。
3. artifact 的 SHA-256 与对象 versionId 已登记。
4. 商品名称保持原文，嵌套 SKU 可展开。
5. 前端展示价存在；真实用户到手价没有证据时允许留空，但不能伪造。
6. 风险事件已经关闭或明确隔离。

门店批次只有所有冻结类目达到可交付状态后才能冻结。页面百分比、Worker 自报完成或单个 Excel 文件都不能代替这一裁决。

## 5. Excel 交付

正式接口先冻结交付版本，再生成：

```text
exports/business-exports/<runId>/v<deliveryVersion>/store-price-data.xlsx
```

工作簿包含：

- `商品清单`
- `SKU规格明细`
- `类目汇总`
- `说明`

业务表不展示账号、Profile、CDP、接口路径或本机长路径。商品名称保持采集原文；前端展示价与有证据的用户到手价分列。导出 artifact 同样保存 SHA-256 和对象 versionId。

## 6. 保留与清理

- 未冻结批次、人工处理中任务和失败重试目录不得删除。
- Master 已确认 artifact 后，Worker 本地文件仍至少保留到该批次 Excel 验收完成。
- 清理必须按完整 `storeId/runId/taskId` 边界执行，禁止按模糊文件名批量删除。
- 任何删除或归档动作都需要业务负责人明确授权；Codex 不自行清理历史数据。

## 7. 每轮业务交付清单

1. 门店、采集日期、runId 和冻结类目数。
2. 原始 JSONL 数、SPU 数、嵌套 SKU 数。
3. 前端展示价覆盖、真实用户到手价覆盖和优惠字段覆盖。
4. 缺失类目、风险事件和人工处置结果。
5. Excel artifact、SHA-256、versionId 和生成时间。
