-- web/data/history.json, one row per farm: the past days as the model saw
-- them. For each hour, the +1 h step of the run that started an hour earlier.
-- Ends at the newest run that reaches max_hours, where export_forecast begins.
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
  format_timestamp(
    '%FT%TZ', timestamp_sub(newest.init_time, interval {{ var('history_days') }} day)
  ) as start,
  format_timestamp('%FT%TZ', newest.init_time) as `end`,
  'wind_speed_100m (m/s), +1 h step of each run' as variable,
  'WeatherNext 3, Google DeepMind. CC BY 4.0 once more than an hour old; '
    || 'newer data falls under the experimental data terms.' as attribution,
  cast(runs.farm_id as string) as farm_id,
  array_agg(
    struct(
      format_timestamp('%FT%TZ', runs.valid_time) as time,
      round(runs.p10, 2) as p10,
      round(runs.p50, 2) as p50,
      round(runs.p90, 2) as p90,
      round({{ capacity_factor('runs.p50') }}, 3) as output_p50
    )
    order by runs.valid_time
  ) as steps
from recent as runs
cross join newest
where
  runs.lead_hours = 1
  and runs.init_time >= timestamp_sub(newest.init_time, interval {{ var('history_days') }} day)
  and runs.init_time < newest.init_time
group by 1, 2, 3, 4, 5
