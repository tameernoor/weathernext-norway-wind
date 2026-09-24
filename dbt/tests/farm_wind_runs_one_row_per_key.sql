-- One row per farm, run and lead hour. Returns the duplicates, if any.
select farm_id, init_time, lead_hours, count(*) as rows_for_key
from {{ ref('farm_wind_runs') }}
-- The last day only, like the tests in schema.yml.
where init_time >= timestamp_sub(current_timestamp(), interval 1 day)
group by 1, 2, 3
having count(*) > 1
