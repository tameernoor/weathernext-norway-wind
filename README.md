# weathernext-norway-wind

A map of Norway's wind farms with WeatherNext 3 wind at 100 metres, roughly turbine hub height, on one timeline. Drag left to see the past five days as the model saw them. Drag right to see the forecast for the next three days.

Each farm is a dot sized by installed capacity. The colour shows expected output from the median forecast. The halo around it grows when the 64 ensemble members disagree, so a small halo means the forecasts agree and a large one means nobody knows yet. Click a farm to see its P10 to P90 band over the whole timeline, with a line at now.

This is an example project. It uses a generic power curve, not each turbine's real one.

## How it works

1. `wnw farms` downloads the 61 operating wind farms from NVE, with location, capacity and hub height, and writes `web/data/farms.geojson`. It also writes the same list as `dbt/seeds/nve_wind_farms.csv` for the dbt route.
2. `wnw forecast` sends those points to BigQuery. One query joins each farm to the WeatherNext grid cell it sits in and returns P10, P50 and P90 of `wind_speed_100m` for the next 72 hours. It uses the newest run from 00, 06, 12 or 18 UTC, since the hourly runs in between stop at 48 hours. The result is written to `web/data/forecast.json`.
3. `wnw history` does the same for the past five days. For each past hour it takes the +1 hour step of the run that started an hour earlier, which is the model's closest view of what the wind was. The result is written to `web/data/history.json`. These are model values, not measurements.
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
uv run wnw forecast --dry-run
uv run wnw forecast

python3 -m http.server -d web 8000
```

Then open http://localhost:8000. Run the commands from the repository root, since they read and write `web/data/`.

The dry run prints Google's estimate of the bytes scanned and bills nothing. For these queries the estimate is far too high. The query filters on a box around Norway, and BigQuery uses that to skip most of the globe, but the estimate doesn't account for it. When this was written, a forecast estimated at 285 GB billed 0.23 GB. The real run prints the bytes actually billed.

Every query is capped at `WNW_MAX_GB` (1000 GB by default). BigQuery checks the cap against its estimate, not against what the query reads, so a query estimated over the cap fails without being charged. `wnw history` and `wnw update` (history plus forecast) read many runs and are estimated at several TB, so the default cap stops them on purpose. The dbt route below builds the same history for a fraction of that. To run them anyway, raise `WNW_MAX_GB` above the estimate for that one run.

`wnw forecast` uses the newest 00, 06, 12 or 18 UTC run, since the hourly runs in between stop at 48 hours. A new one arrives every six hours, about seven hours after it starts. Pass `--init-time` to use an earlier run. `wnw update` runs `wnw history` and `wnw forecast` from the same run, which the map shows as now; run on their own, give them the same time (`--until` and `--init-time`) or the timeline can have a gap.

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

Keep the `&&`. When a test fails, `dbt build` skips everything that depends on it and exits with an error, and the `&&` stops `wnw export`, so the map keeps its last good data. Without it the export would copy stale tables without complaint. Run the chained command every hour: the archive gets every run, and the map moves on with each 00, 06, 12 or 18 UTC run.

The first build loads the past day (`backfill_days`). The history on the map then grows to the full five days over the following days. Check what a build costs before running it: `uv run dbt compile --project-dir dbt --profiles-dir dbt`, then paste `dbt/target/compiled/weathernext_norway_wind/models/archive/farm_wind_runs.sql` into the BigQuery console, which shows the bytes it would read. Like the dry run above, that figure is an upper bound. Once the archive exists, `dbt compile` itself runs the two small lookups described below, about 0.1 GB.

Later builds first list the runs WeatherNext has from the last `backfill_days`, which the Norway box keeps to about 0.1 GB, and read only the runs the archive doesn't have yet. Runs that arrive late or out of order are picked up that way, and none is read twice. If the hourly job stops, the next build catches up by itself, but never further back than `backfill_days`. After a long pause the archive keeps a gap, which drops out of the map's five days within about five days. To fill in missing runs from the last N days instead, run one build with `--vars '{backfill_days: N}'`; it reads only the runs the archive lacks. `backfill_days` is a variable in `dbt/dbt_project.yml`. The archive's tests check the last day of rows, so the cost of each build stays flat as the archive grows. `DBT_LOCATION` must match the location of your WeatherNext dataset.

To see the models and how they depend on each other as a graph, run `uv run dbt docs generate --no-compile --project-dir dbt --profiles-dir dbt` (without `--no-compile` it runs the billed lookups too), then `uv run dbt docs serve --project-dir dbt --profiles-dir dbt`.

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
