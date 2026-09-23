"""Command line entry point: `wnw farms` and `wnw forecast`."""

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

DATA_DIR = Path("web/data")
FARMS_PATH = DATA_DIR / "farms.geojson"


def write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {path}")


def cmd_farms(_: argparse.Namespace) -> None:
    from .farms import fetch_details, fetch_locations, merge

    farms = merge(fetch_locations(), fetch_details())
    write_json(FARMS_PATH, farms)
    print(f"{len(farms['features'])} wind farms")


def cmd_forecast(args: argparse.Namespace) -> None:
    from .forecast import run_query, to_document

    table = args.table or os.environ.get("WEATHERNEXT_TABLE")
    if not table:
        sys.exit("Set WEATHERNEXT_TABLE or pass --table.")
    if not FARMS_PATH.exists():
        sys.exit(f"{FARMS_PATH} not found. Run `wnw farms` first.")

    farms = json.loads(FARMS_PATH.read_text())
    init_time = datetime.fromisoformat(args.init_time)
    # No offset given means UTC; an explicit offset is converted, not overwritten.
    if init_time.tzinfo is None:
        init_time = init_time.replace(tzinfo=UTC)
    init_time = init_time.astimezone(UTC)
    job = run_query(table, farms, init_time, args.max_hours, dry_run=args.dry_run)

    if args.dry_run:
        # Dry runs ignore cluster pruning, so this is an upper bound.
        print(f"would scan at most {job.total_bytes_processed / 1e9:.2f} GB")
        return

    document = to_document(job.result(), init_time)
    print(f"billed {job.total_bytes_billed / 1e9:.2f} GB")
    stamp = init_time.strftime("%Y%m%dT%H%MZ")
    # Keep every run on disk; forecast.json is the copy the map reads.
    write_json(DATA_DIR / f"forecast-{stamp}.json", document)
    write_json(DATA_DIR / "forecast.json", document)
    print(f"{len(document['farms'])} of {len(farms['features'])} farms have forecast data")


def main() -> None:
    parser = argparse.ArgumentParser(prog="wnw", description=__doc__)
    commands = parser.add_subparsers(required=True)

    farms = commands.add_parser("farms", help="download wind farm locations from NVE")
    farms.set_defaults(run=cmd_farms)

    forecast = commands.add_parser("forecast", help="query WeatherNext 3 for each farm")
    forecast.add_argument(
        "--init-time", required=True, help="forecast init time in UTC, e.g. 2026-09-23T00:00"
    )
    forecast.add_argument("--max-hours", type=int, default=48, help="lead time (default 48)")
    forecast.add_argument("--table", help="overrides WEATHERNEXT_TABLE")
    forecast.add_argument("--dry-run", action="store_true", help="print bytes scanned, run nothing")
    forecast.set_defaults(run=cmd_forecast)

    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
