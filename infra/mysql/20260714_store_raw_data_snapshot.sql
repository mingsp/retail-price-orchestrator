CREATE TABLE IF NOT EXISTS fact_store_raw_data_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  store_snapshot_id CHAR(36) NOT NULL COMMENT '一次完整门店采集的数据版本',
  channel_code VARCHAR(32) NOT NULL COMMENT '来源渠道',
  store_code VARCHAR(128) NOT NULL COMMENT '门店稳定编码',
  store_name VARCHAR(255) NOT NULL COMMENT '门店名称',
  source_store_id VARCHAR(128) DEFAULT NULL COMMENT '平台来源门店 ID',
  record_type VARCHAR(32) NOT NULL COMMENT 'product、category 或 other',
  source_spu_id VARCHAR(128) DEFAULT NULL COMMENT '来源 SPU ID，仅用于检索',
  category_key VARCHAR(255) DEFAULT NULL COMMENT '来源类目标识，仅用于检索',
  collected_at DATETIME(3) NOT NULL COMMENT '原始记录采集时间',
  raw_data JSON NOT NULL COMMENT '完整原始 JSON 记录，不裁剪业务字段',
  record_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '原始记录 SHA-256',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '入库时间',
  PRIMARY KEY (id),
  UNIQUE KEY uk_store_raw_record (store_snapshot_id, store_code, record_hash),
  KEY idx_store_raw_spu (store_code, store_snapshot_id, record_type, source_spu_id),
  KEY idx_store_raw_category (store_code, store_snapshot_id, record_type, category_key),
  KEY idx_store_raw_collected (store_code, collected_at),
  CONSTRAINT chk_store_raw_record_type CHECK (record_type IN ('product', 'category'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='门店完整原始数据快照，业务字段由下游按需提取';
