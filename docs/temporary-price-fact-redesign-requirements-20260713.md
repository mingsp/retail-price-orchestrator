# 商圈比价两级价格快照表实施需求

文档状态：已确认，按本方案实施  
确认日期：2026-07-13  
实施范围：先导入已完成的两个门店，表结构支持后续扩展到 6 个门店。

## 1. 目标

RetailMart 只建立两张面向比价业务的价格快照表：

1. `fact_store_spu_price_snapshot`：商品主体价格，一行一个门店来源 SPU。
2. `fact_store_sku_price_snapshot`：规格价格，一行一个门店来源 SKU。

比价时优先使用标准 SKU；SKU 无法匹配时回退到标准 SPU。完整原始响应继续保存在采集系统的 JSONL、对象存储和 PostgreSQL 结构化存证中，不把机器运行字段和完整 raw JSON 塞入 RetailMart 业务表。

## 2. 当前可入库数据

| 门店 | 批次 ID | 来源 SPU | 来源 SKU |
|---|---|---:|---:|
| 乐购达超市（景耀店） | `8d188942-1fcc-4ba5-80d7-a81105a2f410` | 9,020 | 12,749 |
| 呱呱超市（莲湖店） | `5192ebb5-9c99-4746-a1d4-109d4120735b` | 5,785 | 7,897 |
| 合计 | - | 14,805 | 20,646 |

两店每个来源 SPU 均存在至少一个来源 SKU。现有 RetailMart 表中的 7,897 行只来自呱呱批次；迁移前必须保留旧表备份。

## 3. SPU 价格快照表

表名：`fact_store_spu_price_snapshot`

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | `BIGINT UNSIGNED AUTO_INCREMENT` | 技术主键，从 1 开始 |
| `batch_id` | `CHAR(36)` | 采集批次 |
| `snapshot_hour` | `DATETIME` | 上海时区采集时间，向下截断到整点 |
| `channel_code` | `VARCHAR(32)` | 当前为 `meituan_h5` |
| `store_code` | `VARCHAR(128)` | 稳定门店编码 |
| `store_name` | `VARCHAR(255)` | 门店名称 |
| `store_role` | `VARCHAR(32)` | `own` 或 `competitor` |
| `category_name` | `VARCHAR(255)` | 主类目原文 |
| `category_order` | `INT` | 类目顺序 |
| `source_spu_id` | `VARCHAR(128)` | 平台来源 SPU ID |
| `standard_spu_id` | `VARCHAR(64)` | 标准 SPU，未匹配时为空 |
| `product_name` | `VARCHAR(512)` | 采集原始名称，禁止改写 |
| `front_display_price_amount` | `DECIMAL(18,4)` | 前端展示价 |
| `user_final_price_amount` | `DECIMAL(18,4)` | 有明确证据的用户到手价 |
| `original_price_amount` | `DECIMAL(18,4)` | 原价/划线价 |
| `promotion_text` | `VARCHAR(1024)` | 前端优惠文案 |
| `match_status` | `VARCHAR(32)` | `matched`、`unmatched`、`review` |

唯一约束：

```sql
UNIQUE (batch_id, store_code, source_spu_id)
```

## 4. SKU 价格快照表

表名：`fact_store_sku_price_snapshot`

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | `BIGINT UNSIGNED AUTO_INCREMENT` | 技术主键，从 1 开始 |
| `batch_id` | `CHAR(36)` | 采集批次 |
| `snapshot_hour` | `DATETIME` | 上海时区采集时间，向下截断到整点 |
| `channel_code` | `VARCHAR(32)` | 当前为 `meituan_h5` |
| `store_code` | `VARCHAR(128)` | 稳定门店编码 |
| `store_name` | `VARCHAR(255)` | 门店名称 |
| `store_role` | `VARCHAR(32)` | `own` 或 `competitor` |
| `category_name` | `VARCHAR(255)` | 主类目原文 |
| `category_order` | `INT` | 类目顺序 |
| `source_spu_id` | `VARCHAR(128)` | 平台来源 SPU ID |
| `source_sku_id` | `VARCHAR(128)` | 平台来源 SKU ID |
| `standard_spu_id` | `VARCHAR(64)` | 标准 SPU，未匹配时为空 |
| `standard_sku_id` | `VARCHAR(64)` | 标准 SKU，未匹配时为空 |
| `product_name` | `VARCHAR(512)` | 采集原始名称，禁止改写 |
| `spec_name` | `VARCHAR(255)` | 原始规格 |
| `upc` | `VARCHAR(255)` | 商品条码 |
| `front_display_price_amount` | `DECIMAL(18,4)` | SKU 前端展示价 |
| `user_final_price_amount` | `DECIMAL(18,4)` | 有明确证据的 SKU 到手价 |
| `original_price_amount` | `DECIMAL(18,4)` | SKU 原价 |
| `promotion_text` | `VARCHAR(1024)` | SKU 或 SPU 优惠文案 |
| `min_purchase_quantity` | `DECIMAL(18,4)` | 起购数量 |
| `limit_purchase_quantity` | `DECIMAL(18,4)` | 限购数量 |
| `stock_quantity` | `DECIMAL(18,4)` | 库存/可售数量 |
| `sale_status` | `VARCHAR(32)` | 可售状态 |
| `match_status` | `VARCHAR(32)` | `matched`、`unmatched`、`review` |

唯一约束：

```sql
UNIQUE (batch_id, store_code, source_spu_id, source_sku_id)
```

## 5. 价格事实与计算边界

数据库只保存采集到的独立价格事实，不在快照表中提前选择“比较价”：

1. `front_display_price_amount`：每个商品在前端直接显示的价格，完整率必须为 100%。
2. `original_price_amount`：划线价/原价，不能因覆盖率高而误认为页面价副本。
3. `user_final_price_amount`：券后、首件优惠等有原始证据的到手价，允许为空。
4. `promotion_text`、起购量、限购量共同解释优惠价格适用条件。

比较脚本根据业务场景分别比较页面价、到手价或原价。禁止在数据库中保存可由上述事实字段计算的 `comparison_price_amount` 和 `comparison_price_type`。

## 5.1 2026-07-14 字段精简决策

基于两个完整门店的 14,805 条 SPU 和 20,646 条 SKU 实际非空率、字段基数和价格等价性检查，业务事实表进一步去除重复值、运行诊断和可由其他字段推导的列：

- SPU 删除：`brand_name`、`sku_count`、`base_price_amount`、`spu_price_basis`、`match_method`、`match_confidence`、`price_quality`、`created_at`。
- SKU 删除：`unit_price_amount`、`match_method`、`match_confidence`、`price_quality`、`created_at`。
- SPU、SKU 继续删除派生字段：`comparison_price_amount`、`comparison_price_type`。
- 已删除的基础价和 SKU 单价继续保存在原始数据资产中；需要时由独立脚本读取，不在业务事实表重复保存。
- `batch_id` 继续用于批次隔离和幂等约束，但不得在业务 UI 和业务 Excel 中展示。
- 标准 SPU/SKU 与匹配状态继续保留，支撑 SKU 优先、SPU 兜底的后续比价链路。

## 6. 匹配和比价规则

1. 标准 SKU 已确认时，按 `standard_sku_id` 精确比较。
2. SKU 未匹配但标准 SPU 已确认时，按 `standard_spu_id` 回退比较。
3. 两者均未匹配时保留数据并标记 `unmatched`，不强行生成比价。
4. 当前不建立单独匹配表和比价结果表；匹配状态随快照保存，比价由独立脚本计算。

## 7. 迁移与验收

1. 迁移时将现有表完整重命名备份；目标表验收通过且获得业务确认后，允许删除迁移备份。
2. 新建两张最终业务表，字符集统一为 `utf8mb4`，表主键从 1 自增。
3. 从 PostgreSQL 的 `product_snapshots`、`sku_snapshots` 导入两个已完成批次。
4. SPU 主类目选择该 SPU 最小 `category_order` 对应的原始类目；SKU 继承 SPU 主类目。
5. 验收数量必须为 14,805 个 SPU、20,646 个 SKU。
6. 商品名称必须与来源完全一致；采集小时不得为空且分钟、秒均为 0。
7. 同一批次重复执行不得产生重复行。
8. 原始 JSONL、对象存储和 PostgreSQL 存证均不得删除或裁剪。

## 8. 实施结果

实施日期：2026-07-13  
复核日期：2026-07-14

### 8.1 表结构与备份

- 原 `fact_store_sku_price_snapshot` 曾完整备份为 `fact_store_sku_price_snapshot_legacy_20260713`，用于第一次迁移验收。
- 新建 `fact_store_spu_price_snapshot` 和 `fact_store_sku_price_snapshot`。
- 两张新表均使用 `BIGINT UNSIGNED AUTO_INCREMENT` 主键。
- 2026-07-14 第二次字段精简采用临时表复制、逐行对账、双表原子改名方式切换。
- 精简前完整表曾分别备份为 `fact_store_spu_price_snapshot_precompact_20260714` 和 `fact_store_sku_price_snapshot_precompact_20260714`，用于第二次迁移验收。
- 最终来源事实结构为 SPU 17 个字段、SKU 25 个字段；派生比较价不再进入数据库。
- 2026-07-14 第三次精简采用临时表全量复制、保留字段逐行核验和双表原子改名；复验通过后临时备份已删除。
- 2026-07-14 目标表复核通过并获得业务方明确授权后，上述 3 张迁移备份表已删除；MySQL 中仅保留两张当前业务事实表。PostgreSQL、JSONL 和对象存储原始数据不受影响。

### 8.2 双店入库结果

| 门店 | 门店角色 | SPU 行数 | SKU 行数 |
|---|---|---:|---:|
| 乐购达超市（景耀店） | 竞对门店 | 9,020 | 12,749 |
| 呱呱超市（莲湖店） | 我方门店 | 5,785 | 7,897 |
| 合计 | - | 14,805 | 20,646 |

### 8.3 数据质量结果

- SPU 主键范围：1 至 14,805，行数 14,805。
- SKU 主键范围：1 至 20,646，行数 20,646。
- SPU 业务唯一键重复：0。
- SKU 业务唯一键重复：0。
- 采集时间非整点记录：0。
- 商品名称缺失：0。
- 类目名称或类目顺序缺失：0。
- 页面展示价：SPU 14,805/14,805、SKU 20,646/20,646。
- 原价/划线价：SPU 14,805/14,805、SKU 20,646/20,646。
- 有原始证据的用户到手价：SPU 1,140、SKU 1,441；其余为空是正常业务语义。
- `comparison_price_amount`、`comparison_price_type` 在两张正式表中均不存在。
- 两店重新同步后跨库逐业务键审计：缺失 0、多余 0、来源事实字段差异 0。
- PostgreSQL 来源与 MySQL 结果逐业务键对账：SPU 缺失 0、额外 0、商品名不一致 0；SKU 缺失 0、额外 0、商品名不一致 0。
- 两个交付批次状态均为 `synced`；原始 JSONL 归档仍分别保留 48 份和 71 份。
- 精简表与精简前备份的商品名称、业务键、类目和价格字段不一致记录：SPU 0、SKU 0。
- 精简后幂等实写复验仍为 14,805 个 SPU、20,646 个 SKU，没有产生重复行。
- 重复同步不更新 `standard_spu_id`、`standard_sku_id` 和 `match_status`，避免覆盖后续已确认的匹配结果。

### 8.4 当前匹配状态

本次完成的是完整价格事实入库。`standard_sku_id`、`standard_spu_id` 暂未进行未经确认的自动填充，当前记录保留为 `unmatched`。后续比价匹配按“SKU 优先，SKU 无法确认时回退 SPU”的规则执行，禁止把候选匹配直接标记为已确认同品。
