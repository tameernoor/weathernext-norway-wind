-- 100 m wind over Norway: one row per grid cell, forecast run and lead hour.
-- Ephemeral: it is inlined into farm_wind_runs, which filters on init_time.
-- As a view anyone could query it without that filter and scan every run.
{{ config(materialized='ephemeral') }}

select
  t.init_time,
  t.geography_polygon as cell,
  f.time as valid_time,
  f.hours as lead_hours,
  f.wind_speed_100m_p10 as p10,
  f.wind_speed_100m_p50 as p50,
  f.wind_speed_100m_p90 as p90
from {{ source('weathernext', 'forecast_0p1deg') }} as t
cross join unnest(t.forecast) as f
where
  -- Cluster filter on `geography`. planar => true keeps the edges straight;
  -- as great circles the southern edge would bow north past the south coast.
  st_intersects(t.geography, st_geogfromtext('{{ var("norway_box") }}', planar => true))
  and f.hours between 1 and {{ var('max_hours') }}
