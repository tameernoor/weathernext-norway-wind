# weathernext-norway-wind

A map of Norway's wind farms with WeatherNext 3 wind at 100 metres, roughly turbine hub height, on one timeline. Drag left to see the past week as the model saw it. Drag right to see the forecast for the next 48 hours.

Each farm is a dot sized by installed capacity. The colour shows expected output from the median forecast. The halo around it grows when the 64 ensemble members disagree, so a small halo means the forecasts agree and a large one means nobody knows yet. Click a farm to see its P10 to P90 band over the whole timeline, with a line at now.

This is an example project. It uses a generic power curve, not each turbine's real one.

## How it works

1. `wnw farms` downloads the 61 operating wind farms from NVE, with location, capacity and hub height, and writes `web/data/farms.geojson`. It also writes the same list as `dbt/seeds/nve_wind_farms.csv` for the dbt route.
2. `wnw forecast` sends those points to BigQuery. One query joins each farm to the WeatherNext grid cell it sits in and returns P10, P50 and P90 of `wind_speed_100m` for each hour of the newest run. The result is written to `web/data/forecast.json`.
3. `wnw history` does the same for the past week. For each past hour it takes the +1 hour step of the run that started an hour earlier, which is the model's closest view of what the wind was. The result is written to `web/data/history.json`. These are model values, not measurements.
4. `web/` is a static page that reads the files and joins history and forecast into one timeline. No backend.

Both commands also keep a timestamped copy of every run. The queries are in [`src/weathernext_norway_wind/sql/`](src/weathernext_norway_wind/sql/).

## Setup

You need [uv](https://docs.astral.sh/uv/) and access to the WeatherNext BigQuery datasets. Access is allowlisted. Request it with the [WeatherNext data request form](https://docs.google.com/forms/d/e/1FAIpQLSeCf1JY8G78UDWzbm0ly9kJxfSjUIJT5WyMR_HiNqCm-IHIBg/viewform).

```sh
uv sync
cp .env.example .env              # then fill in your table and project
gcloud auth application-default login
```

## Run

```sh
set -a; source .env; set +a

uv run wnw farms
uv run wnw update --dry-run
uv run wnw update

python3 -m http.server -d web 8000
```

Then open http://localhost:8000. Run the commands from the repository root, since they read and write `web/data/`.

The dry run prints an upper bound on bytes scanned and bills nothing. The history estimate looks large, since it counts every run's full forecast array. The query filters on a box around Norway, and BigQuery uses that to skip most of the globe, but dry runs don't account for it. The real run prints the bytes actually billed.

`wnw update` finds the newest run once and runs `wnw history` and `wnw forecast` around it, so the two meet exactly at now. Running it every hour keeps the map current. Pass `--init-time` to use an earlier run. The two commands also run on their own; give them the same time (`--until` and `--init-time`) or the timeline can have a gap. Synoptic runs start at 00, 06, 12 and 18 UTC, and interim runs every hour in between.

## Alternative: a dbt pipeline

The [`dbt/`](dbt/) folder produces the same `forecast.json` and `history.json` as a dbt project on BigQuery. The map doesn't change. The difference is that the data becomes a tested pipeline with its own archive.

- `stg_weathernext__wind_100m` flattens the forecast array over Norway. `stg_nve__wind_farms` reads the farm list, which `wnw farms` writes as a dbt seed.
- `farm_wind_runs` is an incremental archive of every run at every farm. Each build reads only new runs from WeatherNext and adds them, so over time you get your own history to backtest against.
- `export_forecast` and `export_history` have the exact shape of the two JSON files. Their contracts are enforced, so a change that would break the map fails the build instead.
- Tests check one row per farm, run and hour, that P10 ≤ P50 ≤ P90, and that every farm in the archive exists in the farm list. Column tests are in `dbt/models/schema.yml`, and tests written as SQL are in `dbt/tests/`. Source freshness warns when WeatherNext stops delivering new runs.
- `wnw export` copies the export tables into `web/data/` as they are. It holds no logic and reads the tables directly, which BigQuery doesn't bill as a query.

```sh
uv sync --group dbt
set -a; source .env; set +a

uv run wnw farms
uv run dbt source freshness --project-dir dbt --profiles-dir dbt \
  && uv run dbt build --project-dir dbt --profiles-dir dbt \
  && uv run wnw export
```

Keep the `&&`. When a test fails, `dbt build` skips everything that depends on it and exits with an error, and the `&&` stops `wnw export`, so the map keeps its last good data. Without it the export would copy stale tables without complaint. Run the chained command every hour to keep the map current.

The first build loads the past 8 days. Check what that costs before running it: `uv run dbt compile --project-dir dbt --profiles-dir dbt`, then paste `dbt/target/compiled/weathernext_norway_wind/models/archive/farm_wind_runs.sql` into the BigQuery console, which shows the bytes it would read. Like the dry run above, that figure is an upper bound.

Later builds only look at the last 6 hours of runs, so if the hourly job stops for longer, catch up with `uv run dbt build --project-dir dbt --profiles-dir dbt --vars '{lookback_hours: 48}'`. Both are variables in `dbt/dbt_project.yml`. The archive's tests check the last day of rows, so the cost of each build stays flat as the archive grows. `DBT_LOCATION` must match the location of your WeatherNext dataset.

To see the models and how they depend on each other as a graph, run `uv run dbt docs generate --project-dir dbt --profiles-dir dbt`, then `uv run dbt docs serve --project-dir dbt --profiles-dir dbt`.

## Development

```sh
uv run pytest
uv run ruff check .
uv run ruff format .
```

## Caveats

- The forecast is for a roughly 10 km grid cell, not for the turbine. Most Norwegian wind farms sit on ridges and coastal hills that a cell that size cannot resolve.
- Hub heights in Norway range from 31 to 145 metres. The forecast is at 100 metres.
- Expected output comes from the median wind only. The power curve drops to zero above cut-out speed, so running P10 and P90 through it would not give output percentiles.
- Offshore wind at oil and gas installations, such as Hywind Tampen, is not in NVE's dataset.

## Data and licences

- Wind farm data is from the Norwegian Water Resources and Energy Directorate (NVE), under the [Norwegian Licence for Open Government Data (NLOD)](https://data.norge.no/nlod/en/2.0).
- WeatherNext data from more than one hour ago is licensed under CC BY 4.0. Current and future forecasts fall under Google DeepMind's Real-Time Weather Forecasting Experimental Data Terms. For that reason `web/data/forecast*.json` and `web/data/history*.json` are git-ignored. The history ends at now, so its newest hour is real-time data too. Check those terms before you publish a live map.
- Map tiles are from OpenStreetMap.
- The code in this repository is under the [MIT licence](LICENSE).
