-- web/data/forecast.json, one row per farm: the forecast from the newest run
-- that reaches max_hours.
-- `wnw export` writes this table out as is, so every column here is part of
-- the file the map reads. The contract in schema.yml guards that shape.
-- The constant bound on init_time lets BigQuery prune partitions; filtering
-- on max(init_time) alone would scan the whole archive.
with recent as (
  select *
  from {{ ref('farm_wind_runs') }}
  where init_time >= timestamp_sub(current_timestamp(), interval {{ var('history_days') + 1 }} day)
),

-- The newest run that reaches max_hours.
newest as (
  select max(init_time) as init_time
  from recent
  where lead_hours = {{ var('max_hours') }}
)

select
  format_timestamp('%FT%TZ', newest.init_time) as init_time,
  'wind_speed_100m (m/s)' as variable,
  'WeatherNext 3, Google DeepMind' as attribution,
  cast(runs.farm_id as string) as farm_id,
  array_agg(
    struct(
      format_timestamp('%FT%TZ', runs.valid_time) as time,
      runs.lead_hours as hours,
      round(runs.p10, 2) as p10,
      round(runs.p50, 2) as p50,
      round(runs.p90, 2) as p90,
      -- Only the median goes through the power curve: it drops to zero above
      -- cut-out, so P10 and P90 through it would not be output percentiles.
      round({{ capacity_factor('runs.p50') }}, 3) as output_p50
    )
    order by runs.lead_hours
  ) as steps
from recent as runs
join newest on runs.init_time = newest.init_time
group by 1, 2, 3, 4
