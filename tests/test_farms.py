from weathernext_norway_wind.farms import SEED_COLUMNS, merge, seed_rows


def location(number, lon, lat):
    return {
        "properties": {"anleggsnr": number},
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def detail(number, name):
    return {
        "AnleggsNr": number,
        "Navn": name,
        "InstallertEffekt_MW": 57.5,
        "GjsnittNavhoeyde": 64.0,
        "AntallOperativeTurbiner": 25,
        "ElspotomraadeNummer": "3",
        "Kommune": "Åfjord",
        "Fylke": "Trøndelag",
    }


def test_merge_joins_on_plant_number_and_drops_unmatched():
    locations = {"features": [location(2, 10.0, 64.0), location(1, 9.0, 63.0), location(9, 0, 0)]}
    details = [detail(1, "A"), detail(2, "B"), detail(3, "no location")]

    result = merge(locations, details)

    assert [f["properties"]["name"] for f in result["features"]] == ["A", "B"]
    assert result["features"][0]["geometry"]["coordinates"] == [9.0, 63.0]
    assert result["features"][0]["properties"]["price_area"] == "NO3"


def test_seed_rows_are_flat_and_in_column_order():
    farms = merge({"features": [location(1, 9.0, 63.0)]}, [detail(1, "A")])

    (row,) = seed_rows(farms)

    assert list(row) == SEED_COLUMNS
    assert (row["lon"], row["lat"]) == (9.0, 63.0)
