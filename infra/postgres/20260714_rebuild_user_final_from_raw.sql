BEGIN;

-- Rebuild the optional user-final price only from its raw evidence. The raw
-- payload is intentionally left untouched so this correction stays auditable.
WITH raw_actual AS (
  SELECT
    snapshot_id,
    CASE
      WHEN jsonb_typeof(raw #> '{unify_price,actual_price_info}') = 'object'
        THEN raw #> '{unify_price,actual_price_info}'
      WHEN jsonb_typeof(raw -> 'actual_price_info') = 'object'
        THEN raw -> 'actual_price_info'
      ELSE '{}'::jsonb
    END AS info,
    CASE
      WHEN jsonb_typeof(raw #> '{unify_price,actual_price_info}') = 'object'
        THEN 'productRaw.unify_price.actual_price_info'
      ELSE 'productRaw.actual_price_info'
    END AS path_prefix
  FROM product_snapshots
), extracted AS (
  SELECT
    source.snapshot_id,
    candidate.price_value,
    COALESCE(
      NULLIF(btrim(source.info ->> 'actual_price_str'), ''),
      NULLIF(btrim(source.info ->> 'price_str'), ''),
      candidate.raw_value
    ) AS price_text,
    CASE WHEN candidate.field_name IS NOT NULL
      THEN source.path_prefix || '.' || candidate.field_name
    END AS source_path
  FROM raw_actual source
  LEFT JOIN LATERAL (
    SELECT
      value.field_name,
      btrim(value.raw_value) AS raw_value,
      btrim(value.raw_value)::numeric AS price_value
    FROM (VALUES
      (1, 'actual_price', source.info ->> 'actual_price'),
      (2, 'price', source.info ->> 'price'),
      (3, 'actual_price_str', source.info ->> 'actual_price_str'),
      (4, 'price_str', source.info ->> 'price_str')
    ) AS value(priority, field_name, raw_value)
    WHERE btrim(COALESCE(value.raw_value, '')) ~ '^[+]?[0-9]+([.][0-9]+)?$'
    ORDER BY value.priority
    LIMIT 1
  ) candidate ON true
), updated AS (
  UPDATE product_snapshots target
  SET
    user_final_price_value = CASE WHEN source.price_value > 0 THEN source.price_value ELSE NULL END,
    user_final_price_text = CASE WHEN source.price_value > 0 THEN source.price_text ELSE NULL END,
    user_final_price_source_path = CASE WHEN source.price_value > 0 THEN source.source_path ELSE NULL END,
    price_semantics = CASE WHEN source.price_value > 0 THEN 'actual_payable' ELSE 'front_display_only' END
  FROM extracted source
  WHERE target.snapshot_id = source.snapshot_id
    AND (
      target.user_final_price_value IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN source.price_value ELSE NULL END
      OR target.user_final_price_text IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN source.price_text ELSE NULL END
      OR target.user_final_price_source_path IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN source.source_path ELSE NULL END
      OR target.price_semantics IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN 'actual_payable' ELSE 'front_display_only' END
    )
  RETURNING 1
)
SELECT 'product_snapshots' AS table_name, COUNT(*) AS rebuilt_rows FROM updated;

WITH raw_actual AS (
  SELECT
    snapshot_id,
    CASE
      WHEN jsonb_typeof(raw #> '{unify_price,actual_price_info}') = 'object'
        THEN raw #> '{unify_price,actual_price_info}'
      WHEN jsonb_typeof(raw -> 'actual_price_info') = 'object'
        THEN raw -> 'actual_price_info'
      ELSE '{}'::jsonb
    END AS info,
    CASE
      WHEN jsonb_typeof(raw #> '{unify_price,actual_price_info}') = 'object'
        THEN 'sku.unify_price.actual_price_info'
      ELSE 'sku.actual_price_info'
    END AS path_prefix
  FROM sku_snapshots
), extracted AS (
  SELECT
    source.snapshot_id,
    candidate.price_value,
    COALESCE(
      NULLIF(btrim(source.info ->> 'actual_price_str'), ''),
      NULLIF(btrim(source.info ->> 'price_str'), ''),
      candidate.raw_value
    ) AS price_text,
    CASE WHEN candidate.field_name IS NOT NULL
      THEN source.path_prefix || '.' || candidate.field_name
    END AS source_path
  FROM raw_actual source
  LEFT JOIN LATERAL (
    SELECT
      value.field_name,
      btrim(value.raw_value) AS raw_value,
      btrim(value.raw_value)::numeric AS price_value
    FROM (VALUES
      (1, 'actual_price', source.info ->> 'actual_price'),
      (2, 'price', source.info ->> 'price'),
      (3, 'actual_price_str', source.info ->> 'actual_price_str'),
      (4, 'price_str', source.info ->> 'price_str')
    ) AS value(priority, field_name, raw_value)
    WHERE btrim(COALESCE(value.raw_value, '')) ~ '^[+]?[0-9]+([.][0-9]+)?$'
    ORDER BY value.priority
    LIMIT 1
  ) candidate ON true
), updated AS (
  UPDATE sku_snapshots target
  SET
    user_final_price_value = CASE WHEN source.price_value > 0 THEN source.price_value ELSE NULL END,
    user_final_price_text = CASE WHEN source.price_value > 0 THEN source.price_text ELSE NULL END,
    user_final_price_source_path = CASE WHEN source.price_value > 0 THEN source.source_path ELSE NULL END,
    price_semantics = CASE WHEN source.price_value > 0 THEN 'actual_payable' ELSE 'front_display_only' END
  FROM extracted source
  WHERE target.snapshot_id = source.snapshot_id
    AND (
      target.user_final_price_value IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN source.price_value ELSE NULL END
      OR target.user_final_price_text IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN source.price_text ELSE NULL END
      OR target.user_final_price_source_path IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN source.source_path ELSE NULL END
      OR target.price_semantics IS DISTINCT FROM CASE WHEN source.price_value > 0 THEN 'actual_payable' ELSE 'front_display_only' END
    )
  RETURNING 1
)
SELECT 'sku_snapshots' AS table_name, COUNT(*) AS rebuilt_rows FROM updated;

COMMIT;
