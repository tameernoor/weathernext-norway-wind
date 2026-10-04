-- The newest forecast run that reaches past 48 hours: only the runs at 00, 06,
-- 12 and 18 UTC do. Runs appear in BigQuery about 7 hours after they start, so
-- look back a day. The Norway box lets BigQuery skip the rest of the
-- globe, so this reads a few MB per run instead of the whole grid.
SELECT MAX(init_time) AS init_time
FROM `{table}`
WHERE
  init_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
  AND EXTRACT(HOUR FROM init_time) IN (0, 6, 12, 18)
  AND ST_INTERSECTS(geography, ST_GEOGFROMTEXT('{norway_box}', planar => TRUE))
