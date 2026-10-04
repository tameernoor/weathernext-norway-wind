from datetime import UTC, datetime, timedelta

import pytest

from weathernext_norway_wind.forecast import (
    NORWAY_BOX,
    farm_parameter,
    load_sql,
    query_config,
    to_forecast_document,
    to_history_document,
)

INIT = datetime(2026, 9, 23, tzinfo=UTC)
FARMS = {
    "features": [
        {"geometry": {"coordinates": [10.7, 64.4]}, "properties": {"id": 10350}},
    ]
}


def row(hours, p50=12.5):
    return {
        "farm_id": 10350,
        "valid_time": INIT + timedelta(hours=hours),
        "lead_hours": hours,
        "p10": 5.0,
        "p50": p50,
        "p90": 26.0,
    }


def test_queries_are_capped_at_1000_gb_by_default(monkeypatch):
    # Google's estimates for the box queries run far above what they read, and
    # the cap is checked against the estimate, so it sits just under 1 TiB.
    monkeypatch.delenv("WNW_MAX_GB", raising=False)
    assert query_config([]).maximum_bytes_billed == 1_000_000_000_000


def test_cap_follows_wnw_max_gb(monkeypatch):
    monkeypatch.setenv("WNW_MAX_GB", "2.5")
    assert query_config([]).maximum_bytes_billed == 2_500_000_000


@pytest.mark.parametrize("value", ["0", "-1"])
def test_cap_must_be_above_zero(monkeypatch, value):
    # BigQuery may read a cap of 0 as no cap at all.
    monkeypatch.setenv("WNW_MAX_GB", value)
    with pytest.raises(ValueError):
        query_config([])


@pytest.mark.parametrize("name", ["farm_forecast", "farm_history", "latest_init"])
def test_load_sql_fills_in_every_placeholder(name):
    sql = load_sql(name, "p.d.weathernext_3_0_0_0p1deg")
    assert "`p.d.weathernext_3_0_0_0p1deg`" in sql
    assert "{" not in sql


def test_queries_filter_on_the_norway_box():
    for name in ("farm_forecast", "farm_history", "latest_init"):
        assert NORWAY_BOX in load_sql(name, "t")


def test_newest_run_lookup_picks_runs_that_reach_three_days():
    # Only the runs at 00, 06, 12 and 18 UTC go past 48 hours.
    assert "IN (0, 6, 12, 18)" in load_sql("latest_init", "t")


def test_newest_run_lookup_covers_the_publication_delay():
    # Runs appear in BigQuery about 7 hours after they start.
    assert "INTERVAL 24 HOUR" in load_sql("latest_init", "t")


def test_farm_parameter_passes_every_farm():
    assert len(farm_parameter(FARMS).values) == 1


def test_forecast_document_groups_rows_per_farm():
    document = to_forecast_document([row(1), row(2)], INIT)

    steps = document["farms"]["10350"]
    assert [s["hours"] for s in steps] == [1, 2]
    assert steps[0]["output_p50"] == 1.0
    assert document["init_time"] == "2026-09-23T00:00:00+00:00"


def test_history_document_keeps_one_step_per_hour():
    rows = [row(-2), row(-1, p50=6.0), row(-1, p50=7.0)]

    document = to_history_document(rows, INIT - timedelta(days=7), INIT)

    steps = document["farms"]["10350"]
    assert len(steps) == 2
    assert steps[-1]["p50"] == 7.0
    assert "hours" not in steps[0]
