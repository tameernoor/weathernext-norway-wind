# weathernext-norway-wind

A map of Norway's wind farms with the WeatherNext 3 forecast for wind at 100 metres, roughly turbine hub height.

Each farm is a dot sized by installed capacity. The colour shows expected output from the median forecast. The halo around it grows when the 64 ensemble members disagree, so a small halo means the forecasts agree and a large one means nobody knows yet. Click a farm to see its P10 to P90 band over the next 48 hours.

This is an example project. It uses a generic power curve, not each turbine's real one.

## How it works

1. `wnw farms` downloads the 61 operating wind farms from NVE, with location, capacity and hub height, and writes `web/data/farms.geojson`.
2. `wnw forecast` sends those points to BigQuery. One query joins each farm to the WeatherNext grid cell it sits in and returns P10, P50 and P90 of `wind_speed_100m` for each hour. The result is written to `web/data/forecast.json`, plus a timestamped copy of every run.
3. `web/` is a static page that reads both files. No backend.

The query is in [`src/weathernext_norway_wind/sql/farm_forecast.sql`](src/weathernext_norway_wind/sql/farm_forecast.sql).

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
uv run wnw forecast --init-time 2026-09-23T00:00 --dry-run
uv run wnw forecast --init-time 2026-09-23T00:00

python3 -m http.server -d web 8000
```

Then open http://localhost:8000. Run the commands from the repository root, since they read and write `web/data/`.

The dry run prints an upper bound on bytes scanned. The query filters on a box around Norway, and BigQuery uses that to skip most of the globe, but dry runs don't account for it. The real run prints the bytes actually billed.

The init time must be one that exists in the table. Synoptic runs start at 00, 06, 12 and 18 UTC, and interim runs every hour in between.

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
- WeatherNext data from more than one hour ago is licensed under CC BY 4.0. Current and future forecasts fall under Google DeepMind's Real-Time Weather Forecasting Experimental Data Terms. For that reason `web/data/forecast*.json` is git-ignored. Check those terms before you publish a live forecast.
- Map tiles are from OpenStreetMap.
- The code in this repository is under the [MIT licence](LICENSE).
