"""Norway's operating wind farms, from NVE open data (NLOD licence).

Locations come from NVE's map service; capacity and hub height from the
NVE wind power database API. The two are joined on the plant number.
"""

import requests

LOCATIONS_URL = (
    "https://kart.nve.no/enterprise/rest/services/Vindkraft2/MapServer/0/query"
    "?where=1%3D1&outFields=anleggsnr,anleggnavn&outSR=4326&f=geojson"
)
DETAILS_URL = "https://api.nve.no/web/WindPowerplant/GetWindPowerPlantsInOperation"
TIMEOUT_S = 30


def fetch_locations() -> dict:
    response = requests.get(LOCATIONS_URL, timeout=TIMEOUT_S)
    response.raise_for_status()
    return response.json()


def fetch_details() -> list[dict]:
    response = requests.get(DETAILS_URL, headers={"Accept": "application/json"}, timeout=TIMEOUT_S)
    response.raise_for_status()
    return response.json()


SEED_COLUMNS = [
    "id",
    "name",
    "lon",
    "lat",
    "capacity_mw",
    "hub_height_m",
    "turbines",
    "price_area",
    "municipality",
    "county",
]


def seed_rows(farms: dict) -> list[dict]:
    """The farms as flat rows for the dbt seed."""
    rows = []
    for feature in farms["features"]:
        lon, lat = feature["geometry"]["coordinates"]
        rows.append(feature["properties"] | {"lon": lon, "lat": lat})
    return [{column: row[column] for column in SEED_COLUMNS} for row in rows]


def merge(locations: dict, details: list[dict]) -> dict:
    """Join map points to plant details. Farms missing from either side are dropped."""
    by_number = {d["AnleggsNr"]: d for d in details}
    features = []
    for point in locations["features"]:
        detail = by_number.get(point["properties"]["anleggsnr"])
        if detail is None:
            continue
        lon, lat = point["geometry"]["coordinates"]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": detail["AnleggsNr"],
                    "name": detail["Navn"],
                    "capacity_mw": detail["InstallertEffekt_MW"],
                    "hub_height_m": detail["GjsnittNavhoeyde"],
                    "turbines": detail["AntallOperativeTurbiner"],
                    "price_area": f"NO{detail['ElspotomraadeNummer']}",
                    "municipality": detail["Kommune"],
                    "county": detail["Fylke"],
                },
            }
        )
    features.sort(key=lambda f: f["properties"]["id"])
    return {
        "type": "FeatureCollection",
        "attribution": "Norwegian Water Resources and Energy Directorate (NVE), NLOD",
        "features": features,
    }
