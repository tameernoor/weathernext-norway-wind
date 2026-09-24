-- Norway's operating wind farms, from the seed that `wnw farms` writes.
select
  id as farm_id,
  name,
  capacity_mw,
  hub_height_m,
  st_geogpoint(lon, lat) as location
from {{ ref('nve_wind_farms') }}
