# 门店原始数据快照表

## 1. 定位

`fact_store_raw_data_snapshot` 是 RetailMart 中的门店原始数据权威层。

- 表的一行是一条门店商品观察或类目记录，不是一份 JSONL 文件，也不是采集文件批次。
- JSONL 仅是 Master、Worker 和对象存储之间的传输格式。
- `raw_data` 保存采集时得到的完整 JSON 对象，不裁剪价格、SKU、促销或未来新增字段。
- `fact_store_spu_price_snapshot` 和 `fact_store_sku_price_snapshot` 是从原始层生成的业务投影，可以按后续业务规则重新构建。
- 运行日志、验证码事件、文件路径、行号等不属于门店数据，不写入本表的独立字段；混在 artifact 中的运行事件也会被过滤。

三张表使用共同前缀，便于在数据库中集中查看：

1. `fact_store_raw_data_snapshot`
2. `fact_store_sku_price_snapshot`
3. `fact_store_spu_price_snapshot`

## 2. 数据粒度

`store_snapshot_id` 对应一次门店采集的数据版本，当前使用 Master 的 `run_id`。

同一商品可能在“全部”、营销入口和普通类目中被观察多次。原始层保留每次内容不同的观察，业务事实层再按 SPU/SKU 去重。完全相同的原始记录通过以下唯一键幂等去重：

```text
store_snapshot_id + store_code + record_hash
```

`record_hash` 是原始 JSON 文本的 SHA-256，不用于业务比价。

## 3. 字段

| 字段 | 含义 |
| --- | --- |
| `id` | 数据库自增主键 |
| `store_snapshot_id` | 一次门店采集的数据版本 |
| `channel_code` | 来源渠道，如 `meituan_h5` |
| `store_code` | 系统内稳定门店编码 |
| `store_name` | 门店名称 |
| `source_store_id` | 平台来源门店 ID |
| `record_type` | `product` 或 `category` |
| `source_spu_id` | 来源 SPU ID，仅供快速检索 |
| `category_key` | 来源类目标识，仅供快速检索 |
| `collected_at` | 原始记录采集时间，精确到毫秒 |
| `raw_data` | 完整原始 JSON |
| `record_hash` | 幂等哈希 |
| `created_at` | 数据库入库时间 |

## 4. 正式同步链路

1. 先执行门店批次完整性和价格质量门禁。
2. 门禁通过后，从 MinIO 流式读取商品和类目 JSONL。
3. 逐行解析，过滤采集运行事件，以 50 行为一组写入原始表。
4. 每个 artifact 成功后在 Master 元数据中记录同步状态；中断后从未完成 artifact 继续。
5. 原始门店数据完成后，继续写入 SPU/SKU 业务事实表。
6. 重复执行时依靠 artifact 状态和数据库唯一键双重保证幂等。

## 5. 2026-07-14 历史回填结果

| 门店 | 原始行 | 商品观察 | 类目记录 | 原始去重 SPU | 事实 SPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| 乐购达超市（景耀店） | 10,148 | 10,016 | 132 | 9,020 | 9,020 |
| 呱呱超市（莲湖店） | 9,404 | 9,227 | 177 | 5,793 | 5,785 |
| 合计 | 19,552 | 19,243 | 309 | 14,813 | 14,805 |

呱呱原始层比既有事实表多 8 个真实商品。这 8 个商品均有原始名称和一个 SKU，来自“全部”类目，说明旧结构化链路存在漏入库；原始表已完整保留，可用于修复或重建事实层。

## 6. 已验证约束

- `raw_data` JSON 有效率：100%。
- 商品记录缺失 `source_spu_id`：0。
- 重复哈希组：0。
- 非 `product/category` 记录：0。
- 强制复读全部 artifact：新增 0 行，证明幂等。
- 表内没有直接设计业务比价价格列；业务价格规则由下游脚本从 `raw_data` 提取，避免污染原始事实。
