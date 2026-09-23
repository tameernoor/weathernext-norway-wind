-- 100 m wind forecast summary for the grid cell each wind farm sits in.
--
-- {table} is filled in by the Python client (table names cannot be query
-- parameters). @farms is an ARRAY<STRUCT<id INT64, lon FLOAT64, lat FLOAT64>>.
--
-- Column names follow the WeatherNext 3 variable list. Confirm them once your
-- access is approved with
--   SELECT * FROM {table} WHERE init_time = '<an init time>' LIMIT 1
-- Leaving out the init_time filter scans the whole table.
SELECT
  farm.id AS farm_id,
  f.time AS valid_time,
  f.hours AS lead_hours,
  f.wind_speed_100m_p10 AS p10,
  f.wind_speed_100m_p50 AS p50,
  f.wind_speed_100m_p90 AS p90
FROM `{table}` AS t
JOIN UNNEST(@farms) AS farm
  ON ST_INTERSECTS(t.geography_polygon, ST_GEOGPOINT(farm.lon, farm.lat))
CROSS JOIN UNNEST(t.forecast) AS f
WHERE
  -- Partition filter: one forecast run instead of all of them.
  t.init_time = @init_time
  -- Cluster filter: a constant box around Norway on the clustered `geography`
  -- column lets BigQuery skip most of the globe within that run. planar => TRUE
  -- keeps the edges straight; as great circles the southern edge would bow
  -- north past the south-coast farms.
  AND ST_INTERSECTS(
    t.geography,
    ST_GEOGFROMTEXT('POLYGON((4 57.5, 32 57.5, 32 71.5, 4 71.5, 4 57.5))', planar => TRUE)
  )
  AND f.hours <= @max_hours
ORDER BY farm_id, lead_hours
