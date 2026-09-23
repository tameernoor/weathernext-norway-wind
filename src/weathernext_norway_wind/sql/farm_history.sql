-- The recent past as the model saw it. For each hour, take the +1 h step of
-- the run that started an hour earlier: the model's closest view of what the
-- wind was. These are model values, not measurements.
--
-- Placeholders and @farms work as in farm_forecast.sql.
SELECT
  farm.id AS farm_id,
  f.time AS valid_time,
  f.wind_speed_100m_p10 AS p10,
  f.wind_speed_100m_p50 AS p50,
  f.wind_speed_100m_p90 AS p90
FROM `{table}` AS t
JOIN UNNEST(@farms) AS farm
  ON ST_INTERSECTS(t.geography_polygon, ST_GEOGPOINT(farm.lon, farm.lat))
CROSS JOIN UNNEST(t.forecast) AS f
WHERE
  t.init_time >= @start
  AND t.init_time < @end
  AND ST_INTERSECTS(t.geography, ST_GEOGFROMTEXT('{norway_box}', planar => TRUE))
  AND f.hours = 1
ORDER BY farm_id, valid_time
