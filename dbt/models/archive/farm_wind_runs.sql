{#- No build reads WeatherNext further back than this. incremental_predicates
    uses the same bound, so the merge reads only recent archive partitions. -#}
{%- set window_start = "timestamp_sub(current_timestamp(), interval "
    ~ var('backfill_days') ~ " day)" -%}
{{
  config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key=['farm_id', 'init_time', 'lead_hours'],
    partition_by={'field': 'init_time', 'data_type': 'timestamp', 'granularity': 'day'},
    cluster_by=['farm_id'],
    incremental_predicates=["DBT_INTERNAL_DEST.init_time >= " ~ window_start],
  )
}}

-- Every forecast run's first hours at every farm, kept as our own archive.
-- WeatherNext only needs to be read for runs that are new since the last build,
-- so the archive grows by itself and can later be used for backtesting.
select
  farms.farm_id,
  wind.init_time,
  wind.valid_time,
  wind.lead_hours,
  wind.p10,
  wind.p50,
  wind.p90
from {{ ref('stg_weathernext__wind_100m') }} as wind
join {{ ref('stg_nve__wind_farms') }} as farms
  on st_intersects(wind.cell, farms.location)
where
  -- Constant bounds so BigQuery prunes partitions (a subquery reading the
  -- archive would not).
  {#- WeatherNext publishes runs hours late and not always in order. Before the
      build, list the runs it has in the window (the Norway box keeps that to a
      few MB per run) and read only those the archive doesn't have yet. The
      first build has no archive, so every run in the window counts. -#}
  {%- set todo = [] -%}
  {%- if execute -%}
    {%- set runs_sql = "select distinct format_timestamp('%FT%TZ', init_time) from " -%}
    {%- set have = run_query(
          runs_sql ~ this ~ " where init_time >= " ~ window_start
        ).columns[0].values() if is_incremental() else [] -%}
    {%- set available = run_query(
          runs_sql ~ source('weathernext', 'forecast_0p1deg')
          ~ " where init_time >= " ~ window_start
          ~ " and st_intersects(geography, st_geogfromtext('" ~ var('norway_box')
          ~ "', planar => true))"
        ).columns[0].values() -%}
    {%- set missing = available | reject('in', have) | sort | list -%}
    {#- BigQuery estimates every UTC day a query touches as a whole, about
        650 GB, and a daily query quota is checked against that estimate. So
        read one day per build, the oldest first; the next build takes the
        next day. -#}
    {%- for run in missing if run[:10] == missing[0][:10] -%}
      {%- do todo.append(run) -%}
    {%- endfor -%}
  {%- endif %}
  wind.init_time in (
  {%- if todo -%}
    {%- for run in todo %}timestamp('{{ run }}'){{ ", " if not loop.last }}{% endfor -%}
  {%- else -%}
    {#- Nothing to read. A plain `false` would make BigQuery estimate the whole
        table for the merge, and a daily query quota, which is checked against
        the estimate, refuses on that. -#}
    timestamp('1970-01-01T00:00:00Z')
  {%- endif -%}
  )
-- A farm exactly on a cell edge matches two cells; keep one.
qualify row_number() over (
  partition by farms.farm_id, wind.init_time, wind.lead_hours
  order by st_astext(wind.cell)
) = 1
