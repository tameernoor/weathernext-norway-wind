import pytest

from weathernext_norway_wind.export import to_document


def test_to_document_lifts_shared_columns_and_keys_steps_by_farm():
    steps = [{"time": "2026-09-23T01:00:00Z", "p50": 8.0}]
    rows = [
        {"init_time": "2026-09-23T00:00:00Z", "farm_id": "10350", "steps": steps},
        {"init_time": "2026-09-23T00:00:00Z", "farm_id": "10413", "steps": []},
    ]

    document = to_document(rows)

    assert document == {
        "init_time": "2026-09-23T00:00:00Z",
        "farms": {"10350": steps, "10413": []},
    }


def test_to_document_refuses_an_empty_table():
    with pytest.raises(LookupError):
        to_document([])
