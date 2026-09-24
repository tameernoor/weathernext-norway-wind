"""Command line entry point: `wnw farms`, `wnw update`, `wnw forecast`, `wnw history`
and, for the dbt route, `wnw export`."""

import argparse
import csv
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

DATA_DIR = Path("web/data")
FARMS_PATH = DATA_DIR / "farms.geojson"
SEED_PATH = Path("dbt/seeds/nve_wind_farms.csv")


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {path}")


def parse_utc(text: str) -> datetime:
    """No offset given means UTC; an explicit offset is converted, not overwritten."""
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def table_and_farms(args: argparse.Namespace) -> tuple[str, dict]:
    table = args.table or os.environ.get("WEATHERNEXT_TABLE")
    if not table:
        sys.exit("Set WEATHERNEXT_TABLE or pass --table.")
    if not FARMS_PATH.exists():
        sys.exit(f"{FARMS_PATH} not found. Run `wnw farms` first.")
    return table, json.loads(FARMS_PATH.read_text())


def run_time(args: argparse.Namespace, table: str, flag: str) -> datetime:
    """The run named on the command line, or the newest one in the table."""
    from .forecast import latest_init_time

    given = getattr(args, flag)
    if given:
        return parse_utc(given)
    if args.dry_run:
        # Any recent run gives the same estimate, and looking up the newest
        # one would bill a real query.
        return datetime.now(UTC).replace(minute=0, second=0, microsecond=0) - timedelta(hours=2)
    return latest_init_time(table)


def write_run(name: str, document: dict, moment: datetime) -> None:
    # Keep every run on disk; <name>.json is the copy the map reads.
    write_json(DATA_DIR / f"{name}-{moment.strftime('%Y%m%dT%H%MZ')}.json", document)
    write_json(DATA_DIR / f"{name}.json", document)


def save(name: str, document: dict, moment: datetime, job, farm_count: int) -> None:
    print(f"billed {job.total_bytes_billed / 1e9:.2f} GB")
    write_run(name, document, moment)
    print(f"{len(document['farms'])} of {farm_count} farms have data")


def print_dry_run(job) -> None:
    # Dry runs ignore cluster pruning, so this is an upper bound.
    print(f"would scan at most {job.total_bytes_processed / 1e9:.2f} GB")


def cmd_farms(_: argparse.Namespace) -> None:
    from .farms import SEED_COLUMNS, fetch_details, fetch_locations, merge, seed_rows

    farms = merge(fetch_locations(), fetch_details())
    write_json(FARMS_PATH, farms)
    # The same farms as the seed for the dbt route.
    SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SEED_PATH.open("w", newline="", encoding="utf-8") as seed:
        writer = csv.DictWriter(seed, fieldnames=SEED_COLUMNS)
        writer.writeheader()
        writer.writerows(seed_rows(farms))
    print(f"wrote {SEED_PATH}")
    print(f"{len(farms['features'])} wind farms")


def cmd_forecast(args: argparse.Namespace) -> None:
    from .forecast import forecast_job, to_forecast_document

    table, farms = table_and_farms(args)
    init_time = run_time(args, table, "init_time")
    job = forecast_job(table, farms, init_time, args.max_hours, dry_run=args.dry_run)
    if args.dry_run:
        print_dry_run(job)
        return
    document = to_forecast_document(job.result(), init_time)
    save("forecast", document, init_time, job, len(farms["features"]))


def cmd_history(args: argparse.Namespace) -> None:
    from .forecast import history_job, to_history_document

    table, farms = table_and_farms(args)
    end = run_time(args, table, "until")
    start = end - timedelta(days=args.days)
    job = history_job(table, farms, start, end, dry_run=args.dry_run)
    if args.dry_run:
        print_dry_run(job)
        return
    document = to_history_document(job.result(), start, end)
    save("history", document, end, job, len(farms["features"]))


def cmd_export(args: argparse.Namespace) -> None:
    """Write the dbt export tables to the files the map reads."""
    from .export import read_document

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        sys.exit("Set GOOGLE_CLOUD_PROJECT.")
    dataset = f"{project}.{args.dataset}"
    for name in ("forecast", "history"):
        document = read_document(f"{dataset}.export_{name}")
        write_run(name, document, parse_utc(document.get("init_time") or document["end"]))


def cmd_update(args: argparse.Namespace) -> None:
    """History and forecast from the same run, so they meet exactly at now."""
    table, _ = table_and_farms(args)
    args.init_time = args.until = run_time(args, table, "init_time").isoformat()
    cmd_history(args)
    cmd_forecast(args)


def main() -> None:
    parser = argparse.ArgumentParser(prog="wnw", description=__doc__)
    commands = parser.add_subparsers(required=True)

    farms = commands.add_parser("farms", help="download wind farm locations from NVE")
    farms.set_defaults(run=cmd_farms)

    export = commands.add_parser("export", help="dbt route: write the export tables to web/data")
    export.add_argument(
        "--dataset",
        default=os.environ.get("DBT_DATASET", "weathernext_norway_wind"),
        help="dataset dbt builds into (default: DBT_DATASET or weathernext_norway_wind)",
    )
    export.set_defaults(run=cmd_export)

    update = commands.add_parser("update", help="history and forecast around the newest run")
    update.add_argument("--init-time", help="run to use as now, in UTC (default: newest)")
    update.set_defaults(run=cmd_update)

    forecast = commands.add_parser("forecast", help="the forecast from one run, per farm")
    forecast.add_argument(
        "--init-time", help="run to use, in UTC, e.g. 2026-09-23T00:00 (default: newest)"
    )
    forecast.set_defaults(run=cmd_forecast)

    history = commands.add_parser("history", help="the past days as the model saw them")
    history.add_argument(
        "--until", help="end of the history, in UTC (default: newest run, so it meets the forecast)"
    )
    history.set_defaults(run=cmd_history)

    for command in (update, forecast):
        command.add_argument("--max-hours", type=int, default=48, help="lead time (default 48)")
    for command in (update, history):
        command.add_argument("--days", type=int, default=7, help="how far back (default 7)")
    for command in (update, forecast, history):
        command.add_argument("--table", help="overrides WEATHERNEXT_TABLE")
        command.add_argument(
            "--dry-run", action="store_true", help="print bytes scanned, run nothing"
        )

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
