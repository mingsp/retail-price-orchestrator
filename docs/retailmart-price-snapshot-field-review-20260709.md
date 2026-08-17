# RetailMart 价格快照表字段审查

日期：2026-07-09

## 本次阶段目标

优先采集两个门店：

- 乐购达超市（景耀店）
- 呱呱超市（莲湖店）

系统策略：

1. 采集层先保留全量原始数据，不在采集时裁剪字段。
2. 编排系统内部保留 raw JSONL、artifact、product_snapshots、sku_snapshots。
3. 入 RetailMart 业务库时，再按经营分析需要清洗成事实表。

## 已核对表

目标事实表：

- `fact_store_sku_price_snapshot`

相关原始/审计表：

- `sync_raw_source_record`
- `raw_evidence_artifacts`
- `raw_evidence_staging_artifacts`

## 结论

`fact_store_sku_price_snapshot` 字段适合作为“清洗后的 SKU 价格事实表”，不适合作为“完整采集原始数据表”。

原因：

- 它已经有业务口径字段：渠道、门店、商品、规格、用户到手价、前端展示价、划线价、优惠、月售、库存等。
- 它有幂等键：`business_key_hash`。
- 它适合支撑后续同品比价、经营看板和业务 Excel。
- 但它不保留完整页面/接口原始结构，无法承载采集过程中的所有字段和风控/账号/CDP 元信息。

## 字段足够的部分

以下核心业务字段已经覆盖：

- 门店维度：`channel_code`、`channel_name`、`store_type`、`store_code`、`store_name`
- 类目维度：`product_category_name`、`sku_category_name`
- 商品维度：`product_name`、`product_image_url`
- 商品价格：`product_user_price_amount`、`product_front_display_price_text`、`product_base_display_price_amount`、`product_line_price_amount`
- 商品活动：`product_promotion_text`、`product_front_label_text`、`product_limit_purchase_quantity`
- 销售热度：`monthly_sales_text`、`want_heat_text`、`positive_rate_text`
- SKU 维度：`sku_spec_name`、`upc`
- SKU 价格：`sku_effective_price_amount`、`sku_front_display_price_text`、`sku_unit_price_amount`、`sku_original_price_amount`
- SKU 活动和库存：`min_purchase_quantity`、`sku_limit_purchase_quantity`、`sku_promotion_text`、`sku_stock_quantity`、`sku_image_url`
- 数据质量：`data_quality_level`、`missing_source_reason`
- 采集时点：`collected_at`，保存每条 SKU 对应原始 `sourceTs` 转换后的北京时间，禁止用同步时间代替。

## 不适合放在该事实表里的内容

以下内容应该留在 raw/staging/采集系统内部，不建议直接塞进 `fact_store_sku_price_snapshot`：

- 原始接口完整 JSON。
- CDP 端口、Profile、账号、worker、taskId、runId。
- 风控事件、验证码、403/418、登录异常。
- 请求批次、动态 chunk、页面断点。
- 原始类目树、页面顺序、接口路径、价格来源路径完整链路。
- 美团原始 `spu_id`、`sku_id`、`poi_id_str` 的所有调试字段。

## 建议入库链路

推荐三层：

1. `raw artifact`
   - MinIO/S3 保存完整 JSONL、summary、checkpoint、categories。
   - 用于追溯和重新清洗。

2. `product_snapshots` / `sku_snapshots`
   - Retail-Radar 内部结构化快照。
   - 保留原始商品名、SPU/SKU、价格来源路径、用户到手价、前端展示价、采集账号/CDP/Profile/run/task。
   - 这是采集系统的生产状态表。

3. `fact_store_sku_price_snapshot`
   - RetailMart 业务事实表。
   - 只写清洗后的经营字段。
   - 用 `business_key_hash` 做幂等。
   - 到手价仅在存在可验证来源时写入；未发现来源的 SKU 仍完整入库，并标记 `missing_user_final_price`。
   - `collected_at` 必填；缺失真实采集时间时 dry-run 必须阻断。

## 对抗式审查

如果直接把采集结果写入 `fact_store_sku_price_snapshot`：

- 风险 1：字段裁剪过早，后续发现价格口径错了，无法从事实表反推。
- 风险 2：同一商品多 SKU、多活动、多前端标签时，事实表难以承载全部原始证据。
- 风险 3：验证码/账号/CDP 异常无法和数据质量联动。
- 风险 4：重新清洗时缺少 raw evidence，会导致不可审计。

因此当前策略应保持：

- 采集：尽可能全量。
- 存证：raw JSONL + structured snapshot。
- 入仓：清洗后写事实表。
