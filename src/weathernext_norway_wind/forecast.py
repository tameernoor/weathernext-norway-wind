"""Query WeatherNext 3 for the 100 m wind at each wind farm, past and future."""

import os
from datetime import datetime
from importlib.resources import files

from google.cloud import bigquery

from .power import capacity_factor

# A box around mainland Norway; all of NVE's operating farms fall inside it.
NORWAY_BOX = "POLYGON((4 57.5, 32 57.5, 32 71.5, 4 71.5, 4 57.5))"


def load_sql(name: str, table: str) -> str:
    template = files(__package__).joinpath(f"sql/{name}.sql").read_text()
    return template.replace("{table}", table).replace("{norway_box}", NORWAY_BOX)


def farm_parameter(farms: dict) -> bigquery.ArrayQueryParameter:
    points = [
        bigquery.StructQueryParameter(
            None,
            bigquery.ScalarQueryParameter("id", "INT64", f["properties"]["id"]),
            bigquery.ScalarQueryParameter("lon", "FLOAT64", f["geometry"]["coordinates"][0]),
            bigquery.ScalarQueryParameter("lat", "FLOAT64", f["geometry"]["coordinates"][1]),
        )
        for f in farms["features"]
    ]
    return bigquery.ArrayQueryParameter("farms", "STRUCT", points)


def query_config(parameters: list, dry_run: bool = False) -> bigquery.QueryJobConfig:
    # A query that would bill more than WNW_MAX_GB fails without being charged.
    max_bytes = int(float(os.environ.get("WNW_MAX_GB", "1000")) * 1e9)
    if max_bytes < 1:
        # BigQuery may read a cap of 0 as no cap at all.
        raise ValueError("WNW_MAX_GB must be above 0.")
    return bigquery.QueryJobConfig(
        query_parameters=parameters,
        dry_run=dry_run,
        use_query_cache=not dry_run,
        maximum_bytes_billed=max_bytes,
    )


def run_query(sql: str, parameters: list, dry_run: bool = False) -> bigquery.QueryJob:
    return bigquery.Client().query(sql, job_config=query_config(parameters, dry_run))


def latest_init_time(table: str) -> datetime:
    (row,) = run_query(load_sql("latest_init", table), []).result()
    if row["init_time"] is None:
        raise LookupError("No 00, 06, 12 or 18 UTC run in the last 24 hours.")
    return row["init_time"]


def forecast_job(
    table: str, farms: dict, init_time: datetime, max_hours: int, dry_run: bool = False
) -> bigquery.QueryJob:
    parameters = [
        farm_parameter(farms),
        bigquery.ScalarQueryParameter("init_time", "TIMESTAMP", init_time),
        bigquery.ScalarQueryParameter("max_hours", "INT64", max_hours),
    ]
    return run_query(load_sql("farm_forecast", table), parameters, dry_run)


def history_job(
    table: str, farms: dict, start: datetime, end: datetime, dry_run: bool = False
) -> bigquery.QueryJob:
    parameters = [
        farm_parameter(farms),
        bigquery.ScalarQueryParameter("start", "TIMESTAMP", start),
        bigquery.ScalarQueryParameter("end", "TIMESTAMP", end),
    ]
    return run_query(load_sql("farm_history", table), parameters, dry_run)


def step(row) -> dict:
    """One hour at one farm, with expected output from the median wind.

    Only the median goes through the power curve. The curve drops to zero above
    cut-out, so pushing P10 and P90 through it would not give output percentiles.
    """
    return {
        "time": row["valid_time"].isoformat(),
        "p10": round(row["p10"], 2),
        "p50": round(row["p50"], 2),
        "p90": round(row["p90"], 2),
        "output_p50": round(capacity_factor(row["p50"]), 3),
    }


def to_forecast_document(rows, init_time: datetime) -> dict:
    by_farm: dict[str, list[dict]] = {}
    for row in rows:
        by_farm.setdefault(str(row["farm_id"]), []).append(step(row) | {"hours": row["lead_hours"]})
    return {
        "init_time": init_time.isoformat(),
        "variable": "wind_speed_100m (m/s)",
        "attribution": "WeatherNext 3, Google DeepMind",
        "farms": by_farm,
    }


def to_history_document(rows, start: datetime, end: datetime) -> dict:
    # Keyed by time: a farm exactly on a cell edge matches two cells, and
    # should still get one value per hour.
    by_farm: dict[str, dict[str, dict]] = {}
    for row in rows:
        entry = step(row)
        by_farm.setdefault(str(row["farm_id"]), {})[entry["time"]] = entry
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "variable": "wind_speed_100m (m/s), +1 h step of each run",
        "attribution": "WeatherNext 3, Google DeepMind. CC BY 4.0 once more than an hour old; "
        "newer data falls under the experimental data terms.",
        "farms": {farm: list(steps.values()) for farm, steps in by_farm.items()},
    }
