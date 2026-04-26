"""
Generate static OSM scene packs for AERIS 3D quick views.

Outputs JSON payloads under `public/osm-context/<preset>.json` with:
- buildings
- roads
- water
- facilities

These files are loaded client-side for reliable 3D context without depending on
live Overpass availability in the deployed app runtime.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime, UTC
from pathlib import Path
from typing import Dict, List, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "osm-context"

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Keep NOAH-level density (a few thousand buildings) without blowing up file
# sizes. Buildings are ranked by height * sqrt(area) so both landmarks and
# dense neighbourhoods survive the downsample.
MAX_BUILDINGS_PER_PRESET = 3000
MAX_ROADS_PER_PRESET = 2000
MAX_FACILITIES_PER_PRESET = 180
MIN_BUILDING_FOOTPRINT_M2 = 120
COORD_PRECISION = 5  # ~1 m on the ground at this latitude
ROAD_CLASS_WHITELIST = {"motorway", "trunk", "primary", "secondary", "tertiary"}

# Tighter, city-core bboxes so every preset fills the viewport with hundreds of
# real OSM buildings (like Project NOAH) instead of a sparse regional sampling.
PRESETS = [
    {
        "id": "ncr",
        "label": "Metro Manila",
        # Makati / BGC / Ortigas / Mandaluyong / Pasig / Manila core.
        "bbox": (120.97, 14.53, 121.08, 14.64),
    },
    {
        "id": "bicol",
        # Legazpi city proper (matches MGB Albay 5-yr flood hazard bbox).
        "label": "Bicol",
        "bbox": (123.70, 13.10, 123.78, 13.19),
    },
    {
        "id": "eastern-visayas",
        # Tacloban + Cancabato Bay + Daniel Romualdez Airport.
        "label": "Eastern Visayas",
        "bbox": (124.94, 11.21, 125.04, 11.30),
    },
    {
        "id": "cebu",
        # Cebu downtown + Mandaue + Mactan Channel + MCIA.
        "label": "Cebu",
        "bbox": (123.86, 10.27, 123.99, 10.38),
    },
    {
        "id": "davao",
        # Davao City downtown, Agdao, Buhangin, Matina, Talomo.
        "label": "Davao",
        "bbox": (125.55, 7.03, 125.68, 7.16),
    },
]

Point = Tuple[float, float]


def build_query(west: float, south: float, east: float, north: float) -> str:
    # Pull ALL buildings in the bbox (like NOAH does) plus roads, water and
    # multipolygon water relations, and the critical-facility amenities we
    # render as beacons. ``relation[...]; out geom;`` makes sure large water
    # bodies (rivers, bays) come back as fully geometried outer rings rather
    # than just member way references.
    return f"""
[out:json][timeout:180];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary"]({south},{west},{north},{east});
  way["natural"="water"]({south},{west},{north},{east});
  way["waterway"="riverbank"]({south},{west},{north},{east});
  way["landuse"~"reservoir|basin"]({south},{west},{north},{east});
  relation["natural"="water"]({south},{west},{north},{east});
  way["building"]({south},{west},{north},{east});
  node["amenity"~"hospital|clinic|police|fire_station|school|university|townhall|college"]({south},{west},{north},{east});
  way["amenity"~"hospital|clinic|police|fire_station|school|university|townhall|college"]({south},{west},{north},{east});
  node["emergency"~"assembly_point|ambulance_station|evacuation_centre"]({south},{west},{north},{east});
  way["emergency"~"assembly_point|ambulance_station|evacuation_centre"]({south},{west},{north},{east});
  node["office"="government"]({south},{west},{north},{east});
  way["office"="government"]({south},{west},{north},{east});
  node["building"="government"]({south},{west},{north},{east});
  way["building"="government"]({south},{west},{north},{east});
);
out geom qt;
"""


def fetch_preset(bbox: Tuple[float, float, float, float]) -> dict:
    west, south, east, north = bbox
    query = build_query(west, south, east, north)
    last_err: Exception | None = None
    for mirror in OVERPASS_MIRRORS:
        url = f"{mirror}?{urlencode({'data': query})}"
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "aeris-typhoon-terminal/1.0 (+http://localhost)",
            },
        )
        try:
            print(f"  trying mirror {mirror}...", flush=True)
            with urlopen(request, timeout=180) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # network / timeout / 429 / HTTP error
            print(f"    failed: {type(exc).__name__}: {exc}", flush=True)
            last_err = exc
            continue
    raise RuntimeError(f"All Overpass mirrors failed. Last error: {last_err}")


def ensure_closed(coords: List[Point]) -> List[Point]:
    if not coords:
        return coords
    if coords[0] == coords[-1]:
        return coords
    return coords + [coords[0]]


def is_polygon(coords: List[Point]) -> bool:
    return len(coords) >= 4 and coords[0] == coords[-1]


def polygon_centroid(coords: List[Point]) -> Point:
    unique = ensure_closed(coords)[:-1]
    lng = sum(point[0] for point in unique) / len(unique)
    lat = sum(point[1] for point in unique) / len(unique)
    return (lng, lat)


def parse_height(value: str | None) -> float | None:
    if not value:
        return None
    cleaned = "".join(ch for ch in value if ch.isdigit() or ch in ".-")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def facility_category(tags: Dict[str, str]) -> str:
    amenity = tags.get("amenity")
    emergency = tags.get("emergency")
    if amenity in {"hospital", "clinic"}:
        return "hospital"
    if amenity == "fire_station":
        return "fire_station"
    if amenity == "police":
        return "police"
    if amenity in {"school", "college", "university"}:
        return "school"
    if emergency in {"assembly_point", "evacuation_centre"}:
        return "evacuation"
    return "government"


def facility_label(category: str) -> str:
    return {
        "hospital": "Hospital / Clinic",
        "fire_station": "Fire Station",
        "police": "Police",
        "school": "School / Campus",
        "evacuation": "Evacuation Site",
    }.get(category, "Government Facility")


def facility_priority(category: str) -> int:
    return {
        "hospital": 5,
        "evacuation": 4,
        "fire_station": 3,
        "police": 2,
    }.get(category, 1)


def building_kind(tags: Dict[str, str]) -> str:
    amenity = tags.get("amenity")
    if amenity in {"hospital", "clinic"}:
        return "hospital"
    if amenity in {"school", "college", "university"}:
        return "school"
    if tags.get("office") == "government" or tags.get("building") == "government" or amenity == "townhall":
        return "government"
    b = tags.get("building")
    if b in {"industrial", "warehouse"}:
        return "industrial"
    if b in {"commercial", "retail", "office"}:
        return "commercial"
    if b in {"residential", "apartments", "terrace", "house"}:
        return "residential"
    return "building"


def default_building_height(kind: str) -> float:
    return {
        "hospital": 24,
        "government": 22,
        "school": 16,
        "commercial": 24,
        "industrial": 12,
        "residential": 8,
    }.get(kind, 9)


def polygon_area_m2(coords: List[Point]) -> float:
    # Approximate shoelace area in m^2 using a local equirectangular projection
    # around the polygon centroid (good enough for building footprints).
    if len(coords) < 3:
        return 0.0
    lat0 = sum(c[1] for c in coords) / len(coords)
    cos_lat = math.cos(math.radians(lat0))
    # Earth-equator length per degree (meters).
    m_per_deg = 111_320.0
    area = 0.0
    for i in range(len(coords) - 1):
        x1 = coords[i][0] * cos_lat * m_per_deg
        y1 = coords[i][1] * m_per_deg
        x2 = coords[i + 1][0] * cos_lat * m_per_deg
        y2 = coords[i + 1][1] * m_per_deg
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def road_width(road_class: str) -> float:
    return {
        "motorway": 2.6,
        "trunk": 2.2,
        "primary": 1.8,
        "secondary": 1.4,
        "tertiary": 1.1,
    }.get(road_class, 0.9)


def is_road(tags: Dict[str, str]) -> bool:
    return "highway" in tags


def is_water(tags: Dict[str, str]) -> bool:
    return (
        tags.get("natural") == "water"
        or tags.get("waterway") == "riverbank"
        or tags.get("landuse") in {"reservoir", "basin"}
    )


def is_building(tags: Dict[str, str]) -> bool:
    return bool(tags.get("building") and tags.get("building") != "no")


def is_facility(tags: Dict[str, str]) -> bool:
    return bool(
        tags.get("amenity")
        or tags.get("emergency")
        or tags.get("office") == "government"
        or tags.get("building") == "government"
    )


def feature_collection(features: List[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


# Per-category guaranteed minimums. These add up to MAX_FACILITIES_PER_PRESET
# (180) so each category always gets a fair share of the beacon budget even
# in dense bboxes where hospitals/clinics alone could fill the whole cap.
_FACILITY_QUOTAS: Dict[str, int] = {
    "hospital": 45,
    "evacuation": 20,
    "fire_station": 25,
    "police": 25,
    "school": 35,
    "government": 30,
}


def _stratified_facilities(facilities: List[dict], cap: int) -> List[dict]:
    """
    Return up to ``cap`` facilities with a guaranteed per-category quota so
    every marker type (hospital, police, fire, school, evacuation, government)
    appears on the map even in bboxes where one category dominates raw counts.

    Within each category features are ranked by (priority desc, has_name desc)
    so named landmarks beat anonymous ones.  Any leftover slots after filling
    quotas are allocated round-robin to whichever categories still have
    candidates.
    """
    # Group by category, sorted within each group by (priority, has_name).
    buckets: Dict[str, List[dict]] = {}
    for f in facilities:
        cat = f["properties"].get("category", "other")
        buckets.setdefault(cat, []).append(f)
    for cat in buckets:
        buckets[cat].sort(
            key=lambda f: (
                f["properties"].get("priority", 0),
                1 if f["properties"].get("name") else 0,
            ),
            reverse=True,
        )

    selected: List[dict] = []

    # First pass: fill per-category quotas.
    for cat, quota in _FACILITY_QUOTAS.items():
        pool = buckets.get(cat, [])
        take = min(quota, len(pool))
        selected.extend(pool[:take])
        if take < len(pool):
            buckets[cat] = pool[take:]
        else:
            buckets.pop(cat, None)

    # Second pass: distribute remaining capacity round-robin.
    remaining = cap - len(selected)
    active_cats = [c for c in buckets if buckets[c]]
    while remaining > 0 and active_cats:
        next_cats = []
        for cat in active_cats:
            if remaining <= 0:
                break
            pool = buckets[cat]
            selected.append(pool.pop(0))
            remaining -= 1
            if pool:
                next_cats.append(cat)
        active_cats = next_cats

    return selected[:cap]


def build_payload(elements: List[dict]) -> dict:
    roads: List[dict] = []
    water: List[dict] = []
    buildings: List[dict] = []
    facilities: List[dict] = []
    facility_keys = set()

    for element in elements:
        tags = element.get("tags", {})

        if element["type"] == "node" and is_facility(tags):
            lng = element.get("lon")
            lat = element.get("lat")
            if lng is not None and lat is not None:
                push_facility(
                    facilities,
                    facility_keys,
                    (lng, lat),
                    facility_properties(tags),
                )
            continue

        coords = [(point["lon"], point["lat"]) for point in element.get("geometry", [])]
        if len(coords) < 2:
            continue

        if is_road(tags):
            road_class = tags.get("highway", "road")
            roads.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {
                        "roadClass": road_class,
                        "strokeWidth": road_width(road_class),
                        "name": tags.get("name"),
                    },
                }
            )

        if is_polygon(coords) and is_water(tags):
            # Drop tiny water features (fountains, small pools) that only add
            # visual noise.
            if polygon_area_m2(coords) < 500:
                continue
            water.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [ensure_closed(coords)]},
                    "properties": {"kind": "water"},
                }
            )

        if is_polygon(coords) and is_building(tags):
            footprint_m2 = polygon_area_m2(coords)
            if footprint_m2 < MIN_BUILDING_FOOTPRINT_M2:
                continue

            kind = building_kind(tags)
            levels_raw = tags.get("building:levels")
            building_height = parse_height(tags.get("height"))
            building_levels = (
                float(levels_raw) if levels_raw and levels_raw.replace(".", "", 1).isdigit() else None
            )
            min_height = parse_height(tags.get("min_height")) or 0

            if building_height is not None:
                resolved_height = building_height
            elif building_levels is not None:
                resolved_height = max(3.5, building_levels * 3.2)
            else:
                # Larger footprints tend to be taller buildings. Adds depth
                # variation without tagging noise.
                base = default_building_height(kind)
                if footprint_m2 > 5000:
                    base *= 1.8
                elif footprint_m2 > 1500:
                    base *= 1.35
                elif footprint_m2 > 600:
                    base *= 1.1
                resolved_height = base

            buildings.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [ensure_closed(coords)]},
                    "properties": {
                        "kind": kind,
                        "height": round(resolved_height, 1),
                        "minHeight": round(min_height, 1),
                        "name": tags.get("name"),
                    },
                }
            )

        if is_facility(tags):
            push_facility(
                facilities,
                facility_keys,
                polygon_centroid(coords),
                facility_properties(tags),
            )

    # Downsample to NOAH-sized layer without losing landmarks. Score combines
    # height and footprint so both skyscrapers and large malls/hospitals keep
    # the top slots; everything else is sampled proportionally.
    if len(buildings) > MAX_BUILDINGS_PER_PRESET:
        buildings.sort(
            key=lambda f: (
                (f["properties"].get("height") or 0)
                * max(1.0, math.sqrt(polygon_area_m2(f["geometry"]["coordinates"][0])))
            ),
            reverse=True,
        )
        buildings = buildings[:MAX_BUILDINGS_PER_PRESET]

    if len(roads) > MAX_ROADS_PER_PRESET:
        # Priority: bigger roads first (higher strokeWidth).
        roads.sort(
            key=lambda f: f["properties"].get("strokeWidth", 0),
            reverse=True,
        )
        roads = roads[:MAX_ROADS_PER_PRESET]

    facilities = _stratified_facilities(facilities, MAX_FACILITIES_PER_PRESET)

    buildings = [round_feature_coords(f) for f in buildings]
    roads = [round_feature_coords(f) for f in roads]
    water = [round_feature_coords(f) for f in water]
    facilities = [round_feature_coords(f) for f in facilities]

    return {
        "buildings": feature_collection(buildings),
        "roads": feature_collection(roads),
        "water": feature_collection(water),
        "facilities": feature_collection(facilities),
        "generatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "attribution": "OpenStreetMap contributors",
    }


def round_feature_coords(feat: dict) -> dict:
    geom = feat.get("geometry") or {}
    t = geom.get("type")
    coords = geom.get("coordinates")
    if t == "Point":
        geom["coordinates"] = [round(coords[0], COORD_PRECISION), round(coords[1], COORD_PRECISION)]
    elif t == "LineString":
        geom["coordinates"] = [
            [round(c[0], COORD_PRECISION), round(c[1], COORD_PRECISION)] for c in coords
        ]
    elif t == "Polygon":
        geom["coordinates"] = [
            [[round(c[0], COORD_PRECISION), round(c[1], COORD_PRECISION)] for c in ring]
            for ring in coords
        ]
    return feat


def facility_properties(tags: Dict[str, str]) -> dict:
    category = facility_category(tags)
    return {
        "category": category,
        "categoryLabel": facility_label(category),
        "name": tags.get("name") or facility_label(category),
        "priority": facility_priority(category),
        "source": "OpenStreetMap",
    }


def push_facility(
    facilities: List[dict],
    facility_keys: set,
    coordinates: Point,
    properties: dict,
) -> None:
    key = "|".join(
        [
            str(properties.get("category", "other")),
            str(properties.get("name", "facility")).lower(),
            f"{coordinates[0]:.5f}",
            f"{coordinates[1]:.5f}",
        ]
    )
    if key in facility_keys:
        return
    facility_keys.add(key)
    facilities.append(
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": coordinates},
            "properties": properties,
        }
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("preset_ids", nargs="*", help="Optional preset IDs to generate")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    presets = PRESETS
    if args.preset_ids:
        preset_ids = set(args.preset_ids)
        presets = [preset for preset in PRESETS if preset["id"] in preset_ids]

    for index, preset in enumerate(presets):
        print(f"Fetching {preset['label']}...", flush=True)
        response = fetch_preset(preset["bbox"])
        payload = build_payload(response["elements"])

        out_path = OUT_DIR / f"{preset['id']}.json"
        out_path.write_text(
            json.dumps(payload, separators=(",", ":")), encoding="utf-8"
        )
        print(
            f"  wrote {out_path.name}: "
            f"{len(payload['buildings']['features'])} buildings, "
            f"{len(payload['roads']['features'])} roads, "
            f"{len(payload['water']['features'])} water, "
            f"{len(payload['facilities']['features'])} facilities",
            flush=True,
        )
        if index < len(presets) - 1:
            time.sleep(6)


if __name__ == "__main__":
    main()
