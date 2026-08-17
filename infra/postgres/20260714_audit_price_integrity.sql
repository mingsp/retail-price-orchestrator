WITH product_expected AS (
  SELECT
    snapshot.snapshot_id,
    page.price_value AS expected_page_price,
    CASE WHEN actual.price_value > 0 THEN actual.price_value END AS expected_final_price
  FROM product_snapshots snapshot
  LEFT JOIN LATERAL (
    SELECT btrim(candidate.raw_value)::numeric AS price_value
    FROM (VALUES
      (1, snapshot.raw #>> '{unify_price,activity_info,activity_price}'),
      (2, snapshot.raw #>> '{unify_price,price}')
    ) candidate(priority, raw_value)
    WHERE btrim(COALESCE(candidate.raw_value, '')) ~ '^[+]?[0-9]+([.][0-9]+)?$'
    ORDER BY candidate.priority
    LIMIT 1
  ) page ON true
  LEFT JOIN LATERAL (
    SELECT btrim(candidate.raw_value)::numeric AS price_value
    FROM (VALUES
      (1, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'actual_price'),
      (2, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'price'),
      (3, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'actual_price_str'),
      (4, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'price_str')
    ) candidate(priority, raw_value)
    WHERE btrim(COALESCE(candidate.raw_value, '')) ~ '^[+]?[0-9]+([.][0-9]+)?$'
    ORDER BY candidate.priority
    LIMIT 1
  ) actual ON true
), product_audit AS (
  SELECT
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE expected.expected_page_price IS NOT NULL) AS raw_page_price_rows,
    COUNT(*) FILTER (WHERE snapshot.front_display_price_value IS NOT NULL) AS structured_page_price_rows,
    COUNT(*) FILTER (WHERE snapshot.front_display_price_value IS DISTINCT FROM expected.expected_page_price) AS page_price_mismatches,
    COUNT(*) FILTER (WHERE expected.expected_final_price IS NOT NULL) AS raw_final_price_rows,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value IS NOT NULL) AS structured_final_price_rows,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value IS DISTINCT FROM expected.expected_final_price) AS final_price_mismatches,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value <= 0) AS invalid_final_prices,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value IS NOT NULL AND expected.expected_final_price IS NULL) AS fabricated_final_prices
  FROM product_snapshots snapshot
  JOIN product_expected expected USING (snapshot_id)
), sku_expected AS (
  SELECT
    snapshot.snapshot_id,
    page.price_value AS expected_page_price,
    CASE WHEN actual.price_value > 0 THEN actual.price_value END AS expected_final_price
  FROM sku_snapshots snapshot
  LEFT JOIN LATERAL (
    SELECT btrim(candidate.raw_value)::numeric AS price_value
    FROM (VALUES
      (1, snapshot.raw #>> '{unify_price,activity_info,activity_price}'),
      (2, snapshot.raw #>> '{unify_price,price}')
    ) candidate(priority, raw_value)
    WHERE btrim(COALESCE(candidate.raw_value, '')) ~ '^[+]?[0-9]+([.][0-9]+)?$'
    ORDER BY candidate.priority
    LIMIT 1
  ) page ON true
  LEFT JOIN LATERAL (
    SELECT btrim(candidate.raw_value)::numeric AS price_value
    FROM (VALUES
      (1, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'actual_price'),
      (2, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'price'),
      (3, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'actual_price_str'),
      (4, COALESCE(snapshot.raw #> '{unify_price,actual_price_info}', snapshot.raw -> 'actual_price_info') ->> 'price_str')
    ) candidate(priority, raw_value)
    WHERE btrim(COALESCE(candidate.raw_value, '')) ~ '^[+]?[0-9]+([.][0-9]+)?$'
    ORDER BY candidate.priority
    LIMIT 1
  ) actual ON true
), sku_audit AS (
  SELECT
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE expected.expected_page_price IS NOT NULL) AS raw_page_price_rows,
    COUNT(*) FILTER (WHERE snapshot.front_display_price_value IS NOT NULL) AS structured_page_price_rows,
    COUNT(*) FILTER (WHERE snapshot.front_display_price_value IS DISTINCT FROM expected.expected_page_price) AS page_price_mismatches,
    COUNT(*) FILTER (WHERE expected.expected_final_price IS NOT NULL) AS raw_final_price_rows,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value IS NOT NULL) AS structured_final_price_rows,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value IS DISTINCT FROM expected.expected_final_price) AS final_price_mismatches,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value <= 0) AS invalid_final_prices,
    COUNT(*) FILTER (WHERE snapshot.user_final_price_value IS NOT NULL AND expected.expected_final_price IS NULL) AS fabricated_final_prices
  FROM sku_snapshots snapshot
  JOIN sku_expected expected USING (snapshot_id)
)
SELECT 'product_snapshots' AS table_name, * FROM product_audit
UNION ALL
SELECT 'sku_snapshots' AS table_name, * FROM sku_audit;
