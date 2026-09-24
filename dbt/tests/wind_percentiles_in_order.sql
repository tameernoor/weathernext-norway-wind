-- Wind is never negative and P10 <= P50 <= P90. Returns the rows that break it.
select *
from {{ ref('farm_wind_runs') }}
-- The last day only, like the tests in schema.yml.
where init_time >= timestamp_sub(current_timestamp(), interval 1 day)
  and (p10 < 0 or p10 > p50 or p50 > p90)
