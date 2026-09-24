{#- incremental_predicates lets the merge read only recent archive
    partitions instead of the whole table. -#}
{{
  config(
    materialized='incremental',
    incremental_strategy='merge',
    unique_key=['farm_id', 'init_time', 'lead_hours'],
    partition_by={'field': 'init_time', 'data_type': 'timestamp', 'granularity': 'day'},
    cluster_by=['farm_id'],
    incremental_predicates=[
      "DBT_INTERNAL_DEST.init_time >= timestamp_sub(current_timestamp(), interval "
      ~ (var('lookback_hours') + 24) ~ " hour)"
    ],
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
  -- archive's newest run would not). Re-reading a run already in the
  -- archive is harmless: the merge on unique_key replaces it.
  {% if is_incremental() %}
  wind.init_time >= timestamp_sub(current_timestamp(), interval {{ var('lookback_hours') }} hour)
  {% else %}
  wind.init_time >= timestamp_sub(current_timestamp(), interval {{ var('backfill_days') }} day)
  {% endif %}
-- A farm exactly on a cell edge matches two cells; keep one.
qualify row_number() over (
  partition by farms.farm_id, wind.init_time, wind.lead_hours
  order by st_astext(wind.cell)
) = 1
