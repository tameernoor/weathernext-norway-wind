"""Query WeatherNext 3 for the 100 m wind forecast at each wind farm."""

from datetime import datetime
from importlib.resources import files

from google.cloud import bigquery

from .power import capacity_factor


def load_sql(table: str) -> str:
    template = files(__package__).joinpath("sql/farm_forecast.sql").read_text()
    return template.replace("{table}", table)


def query_parameters(
    farms: dict, init_time: datetime, max_hours: int
) -> list[bigquery.ArrayQueryParameter | bigquery.ScalarQueryParameter]:
    points = [
        bigquery.StructQueryParameter(
            None,
            bigquery.ScalarQueryParameter("id", "INT64", f["properties"]["id"]),
            bigquery.ScalarQueryParameter("lon", "FLOAT64", f["geometry"]["coordinates"][0]),
            bigquery.ScalarQueryParameter("lat", "FLOAT64", f["geometry"]["coordinates"][1]),
        )
        for f in farms["features"]
    ]
    return [
        bigquery.ArrayQueryParameter("farms", "STRUCT", points),
        bigquery.ScalarQueryParameter("init_time", "TIMESTAMP", init_time),
        bigquery.ScalarQueryParameter("max_hours", "INT64", max_hours),
    ]


def run_query(
    table: str, farms: dict, init_time: datetime, max_hours: int, dry_run: bool = False
) -> bigquery.QueryJob:
    config = bigquery.QueryJobConfig(
        query_parameters=query_parameters(farms, init_time, max_hours),
        dry_run=dry_run,
        use_query_cache=not dry_run,
    )
    return bigquery.Client().query(load_sql(table), job_config=config)


def to_document(rows, init_time: datetime) -> dict:
    """Group query rows per farm, adding expected output from the median wind.

    Only the median goes through the power curve. The curve drops to zero above
    cut-out, so pushing P10 and P90 through it would not give output percentiles.
    """
    by_farm: dict[str, list[dict]] = {}
    for row in rows:
        by_farm.setdefault(str(row["farm_id"]), []).append(
            {
                "time": row["valid_time"].isoformat(),
                "hours": row["lead_hours"],
                "p10": round(row["p10"], 2),
                "p50": round(row["p50"], 2),
                "p90": round(row["p90"], 2),
                "output_p50": round(capacity_factor(row["p50"]), 3),
            }
        )
    return {
        "init_time": init_time.isoformat(),
        "variable": "wind_speed_100m (m/s)",
        "attribution": "WeatherNext 3, Google DeepMind",
        "farms": by_farm,
    }
