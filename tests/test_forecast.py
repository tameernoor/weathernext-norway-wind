from datetime import UTC, datetime, timedelta

from weathernext_norway_wind.forecast import load_sql, query_parameters, to_document

INIT = datetime(2026, 9, 23, tzinfo=UTC)
FARMS = {
    "features": [
        {"geometry": {"coordinates": [10.7, 64.4]}, "properties": {"id": 10350}},
    ]
}


def test_load_sql_fills_in_table():
    sql = load_sql("p.d.weathernext_3_0_0_0p1deg")
    assert "`p.d.weathernext_3_0_0_0p1deg`" in sql
    assert "{table}" not in sql


def test_query_parameters_pass_every_farm():
    params = {p.name: p for p in query_parameters(FARMS, INIT, 48)}
    assert len(params["farms"].values) == 1
    assert params["max_hours"].value == 48


def test_to_document_groups_rows_per_farm():
    rows = [
        {
            "farm_id": 10350,
            "valid_time": INIT + timedelta(hours=h),
            "lead_hours": h,
            "p10": 5.0,
            "p50": 12.5,
            "p90": 26.0,
        }
        for h in (1, 2)
    ]

    document = to_document(rows, INIT)

    steps = document["farms"]["10350"]
    assert [s["hours"] for s in steps] == [1, 2]
    assert steps[0]["output_p50"] == 1.0
    assert document["init_time"] == "2026-09-23T00:00:00+00:00"
