BEGIN;

WITH updated AS (
  UPDATE product_snapshots
  SET user_final_price_text = NULL,
      user_final_price_value = NULL,
      user_final_price_source_path = NULL,
      price_semantics = 'front_display_only'
  WHERE price_semantics = 'actual_payable'
    AND user_final_price_source_path IS NOT NULL
    AND (user_final_price_value IS NULL OR user_final_price_value <= 0)
  RETURNING 1
)
SELECT 'product_snapshots' AS table_name, COUNT(*) AS quarantined_rows FROM updated;

WITH updated AS (
  UPDATE sku_snapshots
  SET user_final_price_text = NULL,
      user_final_price_value = NULL,
      user_final_price_source_path = NULL,
      price_semantics = 'front_display_only'
  WHERE price_semantics = 'actual_payable'
    AND user_final_price_source_path IS NOT NULL
    AND (user_final_price_value IS NULL OR user_final_price_value <= 0)
  RETURNING 1
)
SELECT 'sku_snapshots' AS table_name, COUNT(*) AS quarantined_rows FROM updated;

COMMIT;
