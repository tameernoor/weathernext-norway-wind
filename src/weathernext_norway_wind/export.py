"""dbt route: turn an export table into the JSON the map reads.

No logic lives here. dbt shapes and tests the table; this only copies it out.
"""

from google.cloud import bigquery


def to_document(rows) -> dict:
    """One row per farm. Every column but farm_id and steps is the same on
    every row and becomes a top-level field of the file."""
    rows = [dict(row.items()) for row in rows]
    if not rows:
        raise LookupError("The export table is empty. Did `dbt build` run?")
    header = {key: value for key, value in rows[0].items() if key not in ("farm_id", "steps")}
    return header | {"farms": {row["farm_id"]: row["steps"] for row in rows}}


def read_document(table: str) -> dict:
    # list_rows reads the table directly, which BigQuery does not bill as a query.
    return to_document(bigquery.Client().list_rows(table))
