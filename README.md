# weathernext-norway-wind

A map of Norway's wind farms with WeatherNext 3 wind at 100 metres, roughly turbine hub height, on one timeline. Drag left to see the past week as the model saw it. Drag right to see the forecast for the next 48 hours.

Each farm is a dot sized by installed capacity. The colour shows expected output from the median forecast. The halo around it grows when the 64 ensemble members disagree, so a small halo means the forecasts agree and a large one means nobody knows yet. Click a farm to see its P10 to P90 band over the whole timeline, with a line at now.

This is an example project. It uses a generic power curve, not each turbine's real one.

## How it works

1. `wnw farms` downloads the 61 operating wind farms from NVE, with location, capacity and hub height, and writes `web/data/farms.geojson`.
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
