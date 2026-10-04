import argparse
from datetime import UTC, datetime

import pytest

from weathernext_norway_wind import cli, forecast


@pytest.fixture
def no_lookup(monkeypatch):
    def fail(_table):
        raise AssertionError("looked up the newest run")

    monkeypatch.setattr(forecast, "latest_init_time", fail)


def test_dry_run_never_bills_a_newest_run_lookup(no_lookup):
    namespace = argparse.Namespace(init_time=None, dry_run=True)
    assert cli.run_time(namespace, "t", "init_time").tzinfo is not None


def test_given_time_is_converted_to_utc(no_lookup):
    namespace = argparse.Namespace(init_time="2026-09-23T02:00+02:00", dry_run=False)
    assert cli.run_time(namespace, "t", "init_time") == datetime(2026, 9, 23, tzinfo=UTC)


@pytest.mark.parametrize("command", ["update", "forecast"])
def test_forecast_reaches_three_days_by_default(command):
    assert cli.build_parser().parse_args([command]).max_hours == 72


@pytest.mark.parametrize("command", ["update", "history"])
def test_history_goes_five_days_back_by_default(command):
    assert cli.build_parser().parse_args([command]).days == 5
