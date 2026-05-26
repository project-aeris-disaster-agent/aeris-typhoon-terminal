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
from typing import Dict, List, Optional, Tuple
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

# NOTE on caps (priority: visualise EVERY critical facility in every barangay):
# These are now generous safety ceilings, not visual rationing knobs. Per-city
# packs (Naga, Cebu, Davao, NCR, Eastern Visayas, Bicol regional) are tightly
# bboxed so the raw Overpass response rarely exceeds these. The previous
# 180-facility cap with a per-category quota was the root cause of "barangay
# halls / clinics / churches not showing up" complaints.
MAX_BUILDINGS_PER_PRESET = 8000
MAX_ROADS_PER_PRESET = 4000
MAX_FACILITIES_PER_PRESET = 5000
# Drop only sub-residential-room footprints (sheds, kiosks). Many PH barangay
# halls and rural clinics are 30-80 m² so the previous 120 m² floor silently
# stripped them out.
MIN_BUILDING_FOOTPRINT_M2 = 25
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
        # Wider Bicol coverage: Legazpi (Albay), Tabaco, Daraga, and Sorsogon
        # City. East edge widened to 124.05 so Sorsogon City (~123.99) is
        # safely inside the pack. Naga has its own tighter pack (see below).
        "label": "Bicol",
        "bbox": (123.10, 12.85, 124.05, 13.75),
    },
    {
        "id": "naga",
        # Tight bbox around Naga City (Camarines Sur) so the full 180/3000
        # facility/building budget is concentrated on Naga + immediate
        # neighbours (Pili, Magarao, Canaman, Camaligan). Naga is a regular
        # disaster-impact target so it gets first-class quick-view coverage.
        "label": "Naga",
        "bbox": (123.13, 13.57, 123.27, 13.68),
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
    # Pull ALL buildings in the bbox plus the broadest set of critical-facility
    # tags we can map to a category. The scope deliberately includes the
    # PH-specific tagging conventions that the original query missed:
    #   - Barangay halls (often `office=government`, `amenity=townhall`,
    #     `building=public/civic`, or just named "Barangay Hall")
    #   - Pharmacies / dispensaries (drugstores are real critical facilities
    #     during typhoons — meds & medical supply distribution)
    #   - Places of worship (churches double as evacuation centres in PH)
    #   - Kindergartens, daycares, community centres
    #   - Courthouses, prisons, public administration buildings
    #   - Social facilities, NGO offices
    AMENITY = (
        "hospital|clinic|doctors|dentist|pharmacy|"
        "police|fire_station|"
        "school|university|college|kindergarten|childcare|"
        "townhall|courthouse|prison|public_building|"
        "community_centre|social_facility|"
        "place_of_worship"
    )
    # Standalone-building facility tags: covers the cases where a building is
    # tagged ONLY as `building=*` with no surrounding `amenity=*` compound.
    # School/hospital `building=*` tags are deliberately omitted — they're
    # almost always inside a tagged `amenity=school|hospital` polygon, and
    # rendering each ward / classroom as its own beacon clutters the scene.
    BUILDING = (
        "fire_station|government|public|civic|"
        "church|chapel|cathedral|mosque|temple|religious"
    )
    OFFICE = "government|administrative|ngo|political_party|notary"
    return f"""
[out:json][timeout:240];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary"]({south},{west},{north},{east});
  way["natural"="water"]({south},{west},{north},{east});
  way["waterway"="riverbank"]({south},{west},{north},{east});
  way["landuse"~"reservoir|basin"]({south},{west},{north},{east});
  relation["natural"="water"]({south},{west},{north},{east});
  way["building"]({south},{west},{north},{east});
  node["amenity"~"{AMENITY}"]({south},{west},{north},{east});
  way["amenity"~"{AMENITY}"]({south},{west},{north},{east});
  node["emergency"~"assembly_point|ambulance_station|evacuation_centre|disaster_response|fire_hydrant"]({south},{west},{north},{east});
  way["emergency"~"assembly_point|ambulance_station|evacuation_centre|disaster_response"]({south},{west},{north},{east});
  node["office"~"{OFFICE}"]({south},{west},{north},{east});
  way["office"~"{OFFICE}"]({south},{west},{north},{east});
  node["building"~"{BUILDING}"]({south},{west},{north},{east});
  way["building"~"{BUILDING}"]({south},{west},{north},{east});
  node["healthcare"~"hospital|clinic|doctor|pharmacy"]({south},{west},{north},{east});
  way["healthcare"~"hospital|clinic|doctor|pharmacy"]({south},{west},{north},{east});
);
out geom qt;
"""


def fetch_preset(bbox: Tuple[float, float, float, float]) -> dict:
    """
    Fetch the Overpass payload for a preset bbox. Retries through every
    mirror, then loops the entire mirror list up to ``MAX_FULL_RETRIES`` times
    with a back-off — `IncompleteRead` and `Gateway Timeout` are common at
    NCR-scale payloads (>50 MB) and almost always succeed within 2-3 attempts.
    """
    west, south, east, north = bbox
    query = build_query(west, south, east, north)
    last_err: Exception | None = None
    MAX_FULL_RETRIES = 3
    for attempt in range(MAX_FULL_RETRIES):
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
                print(
                    f"  attempt {attempt + 1}/{MAX_FULL_RETRIES} via {mirror}...",
                    flush=True,
                )
                with urlopen(request, timeout=300) as response:
                    return json.loads(response.read().decode("utf-8"))
            except Exception as exc:  # network / timeout / 429 / HTTP error
                print(f"    failed: {type(exc).__name__}: {exc}", flush=True)
                last_err = exc
                continue
        if attempt < MAX_FULL_RETRIES - 1:
            sleep_for = 30 * (attempt + 1)
            print(f"  all mirrors failed, sleeping {sleep_for}s before retry...", flush=True)
            time.sleep(sleep_for)
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


def point_in_polygon(coords: List[Point], lng: float, lat: float) -> bool:
    ring = ensure_closed(coords)
    inside = False
    n = len(ring) - 1
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[i + 1]
        if (y0 > lat) != (y1 > lat):
            x_intersect = (x1 - x0) * (lat - y0) / (y1 - y0) + x0
            if lng < x_intersect:
                inside = not inside
    return inside


def _distance_point_to_segment(
    lng: float,
    lat: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
) -> float:
    dx = bx - ax
    dy = by - ay
    len_sq = dx * dx + dy * dy
    if len_sq == 0:
        return math.hypot(lng - ax, lat - ay)
    t = ((lng - ax) * dx + (lat - ay) * dy) / len_sq
    t = max(0.0, min(1.0, t))
    px = ax + t * dx
    py = ay + t * dy
    return math.hypot(lng - px, lat - py)


def _distance_point_to_ring(coords: List[Point], lng: float, lat: float) -> float:
    ring = ensure_closed(coords)
    min_dist = float("inf")
    for i in range(len(ring) - 1):
        ax, ay = ring[i]
        bx, by = ring[i + 1]
        min_dist = min(
            min_dist,
            _distance_point_to_segment(lng, lat, ax, ay, bx, by),
        )
    return min_dist


def _closest_point_on_ring(coords: List[Point], lng: float, lat: float) -> Point:
    ring = ensure_closed(coords)
    best = ring[0]
    min_dist = float("inf")
    for i in range(len(ring) - 1):
        ax, ay = ring[i]
        bx, by = ring[i + 1]
        dx = bx - ax
        dy = by - ay
        len_sq = dx * dx + dy * dy
        t = 0.0
        if len_sq > 0:
            t = ((lng - ax) * dx + (lat - ay) * dy) / len_sq
            t = max(0.0, min(1.0, t))
        px = ax + t * dx
        py = ay + t * dy
        dist = math.hypot(lng - px, lat - py)
        if dist < min_dist:
            min_dist = dist
            best = (px, py)
    return best


def polygon_label_point(coords: List[Point]) -> Point:
    """
    Interior point for a facility on a building polygon. Vertex-average centroids
    often fall outside L/U footprints; this prefers an interior grid point with
    maximum clearance from the boundary (pole-of-inaccessibility approximation).
    """
    unique = ensure_closed(coords)[:-1]
    if len(unique) < 3:
        return polygon_centroid(coords)

    centroid = polygon_centroid(coords)
    if point_in_polygon(coords, centroid[0], centroid[1]):
        return centroid

    min_lng = min(p[0] for p in unique)
    max_lng = max(p[0] for p in unique)
    min_lat = min(p[1] for p in unique)
    max_lat = max(p[1] for p in unique)
    span_lng = max_lng - min_lng
    span_lat = max_lat - min_lat
    cells = 10
    best = centroid
    best_dist = -1.0
    for ix in range(cells + 1):
        for iy in range(cells + 1):
            lng = min_lng + span_lng * ix / cells
            lat = min_lat + span_lat * iy / cells
            if not point_in_polygon(coords, lng, lat):
                continue
            dist = _distance_point_to_ring(coords, lng, lat)
            if dist > best_dist:
                best_dist = dist
                best = (lng, lat)
    if best_dist >= 0:
        return best
    return _closest_point_on_ring(coords, centroid[0], centroid[1])


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
    healthcare = tags.get("healthcare")
    building = tags.get("building")
    name = (tags.get("name") or "").lower()

    # Healthcare cluster — hospitals, clinics, drugstores, doctors. Pharmacies
    # are critical during typhoons (medicine distribution, basic care). Note
    # we deliberately don't categorise `building=hospital|clinic` as a separate
    # facility (see _STANDALONE_FACILITY_BUILDINGS comment) — those are
    # individual buildings inside a hospital compound, not separate hospitals.
    if (
        amenity in {"hospital", "clinic", "doctors", "dentist", "pharmacy"}
        or healthcare in {"hospital", "clinic", "doctor", "pharmacy"}
    ):
        return "hospital"

    if amenity == "fire_station" or building == "fire_station":
        return "fire_station"

    if amenity == "police":
        return "police"

    # Same rule for schools — `building=school` only counts as a facility if
    # there's no surrounding `amenity=school` compound (handled by is_facility).
    if amenity in {"school", "college", "university", "kindergarten", "childcare"}:
        return "school"

    # PH custom: places of worship double as evac centres during disasters.
    # Tag them as `evacuation` so they take the green/high-priority colouring.
    if (
        emergency in {"assembly_point", "evacuation_centre", "disaster_response"}
        or amenity == "place_of_worship"
        or building in {"church", "chapel", "cathedral", "mosque", "temple", "religious"}
    ):
        return "evacuation"

    if amenity in {"community_centre", "social_facility"}:
        return "evacuation"

    # Barangay halls have noisy tagging — name fallback catches the ones that
    # only have name="Barangay X Hall" without a clean structured tag.
    if "barangay" in name and ("hall" in name or "office" in name):
        return "government"

    return "government"


def facility_label(category: str) -> str:
    return {
        "hospital": "Hospital / Clinic / Pharmacy",
        "fire_station": "Fire Station",
        "police": "Police",
        "school": "School / Campus",
        "evacuation": "Evacuation Site / Place of Worship",
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


_FACILITY_AMENITIES = {
    "hospital", "clinic", "doctors", "dentist", "pharmacy",
    "police", "fire_station",
    "school", "university", "college", "kindergarten", "childcare",
    "townhall", "courthouse", "prison", "public_building",
    "community_centre", "social_facility",
    "place_of_worship",
}
# Buildings that BY THEMSELVES (no amenity / office / healthcare tag) qualify
# as a critical facility. Deliberately narrow: government / public / civic /
# fire stations / standalone places of worship. We exclude `building=school`
# / `building=hospital` because OSM tags every single classroom and ward as
# `building=school|hospital` inside school/hospital compounds, which would
# otherwise produce hundreds of duplicated beacons stacked on the same
# campus. The compound itself (the `amenity=school|hospital` polygon) still
# becomes one beacon at the centroid.
_STANDALONE_FACILITY_BUILDINGS = {
    "fire_station", "government", "public", "civic",
    "church", "chapel", "cathedral", "mosque", "temple", "religious",
}
_FACILITY_OFFICES = {"government", "administrative", "ngo", "political_party", "notary"}
_FACILITY_HEALTHCARE = {"hospital", "clinic", "doctor", "pharmacy"}


def is_facility(tags: Dict[str, str]) -> bool:
    if tags.get("amenity") in _FACILITY_AMENITIES:
        return True
    if tags.get("emergency"):
        return True
    if tags.get("office") in _FACILITY_OFFICES:
        return True
    if tags.get("building") in _STANDALONE_FACILITY_BUILDINGS:
        return True
    if tags.get("healthcare") in _FACILITY_HEALTHCARE:
        return True
    return False


def feature_collection(features: List[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


# Per-category MINIMUM guarantees. Unlike the old quota system, these are
# floors not ceilings — they only kick in when the total exceeds the cap.
# When that happens, each category gets its guaranteed minimum first
# (sorted by priority + name), then the rest of the cap is filled with the
# highest-priority remaining facilities across all categories.
_FACILITY_CATEGORY_MIN: Dict[str, int] = {
    "hospital": 200,
    "evacuation": 200,
    "fire_station": 50,
    "police": 100,
    "school": 400,
    "government": 300,
}


def _trim_facilities(facilities: List[dict], cap: int) -> List[dict]:
    """
    Return up to ``cap`` facilities. If the raw count exceeds the cap, each
    category gets its ``_FACILITY_CATEGORY_MIN`` floor first (so dense
    bboxes like NCR don't drown out schools/barangay halls behind hospitals
    and churches), then the remaining slots go to the highest-priority
    candidates regardless of category.

    Within each pool we sort by (priority desc, has_name desc) so named
    landmarks beat anonymous nodes when the cap bites.
    """
    if len(facilities) <= cap:
        return facilities

    buckets: Dict[str, List[dict]] = {}
    for f in facilities:
        cat = f["properties"].get("category", "other")
        buckets.setdefault(cat, []).append(f)

    sort_key = lambda f: (
        f["properties"].get("priority", 0),
        1 if f["properties"].get("name") else 0,
    )
    for cat in buckets:
        buckets[cat].sort(key=sort_key, reverse=True)

    # First pass: fill per-category minimum guarantees.
    selected: List[dict] = []
    leftovers: List[dict] = []
    for cat, pool in buckets.items():
        floor = _FACILITY_CATEGORY_MIN.get(cat, 0)
        take = min(floor, len(pool))
        selected.extend(pool[:take])
        leftovers.extend(pool[take:])

    # Second pass: fill remaining cap from the global priority-sorted leftovers.
    leftovers.sort(key=sort_key, reverse=True)
    remaining = cap - len(selected)
    if remaining > 0:
        selected.extend(leftovers[:remaining])

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
                    facility_properties(tags, (lng, lat), element.get("id")),
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
            label_point = polygon_label_point(coords)
            push_facility(
                facilities,
                facility_keys,
                label_point,
                facility_properties(tags, label_point, element.get("id")),
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

    facilities = _trim_facilities(facilities, MAX_FACILITIES_PER_PRESET)

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


def _facility_code(category: str, lon: float, lat: float) -> str:
    prefix = {
        "hospital": "HSP",
        "fire_station": "FR",
        "police": "POL",
        "school": "SCH",
        "evacuation": "EVC",
        "government": "GOV",
    }.get(category, "CF")
    n = abs(round(lon * 1e4 + lat * 1e4)) % 100000
    return f"{prefix}-{n:05d}"


def _facility_contact(tags: Dict[str, str]) -> dict:
    phone = tags.get("phone") or tags.get("contact:phone") or tags.get("contact:mobile")
    email = tags.get("email") or tags.get("contact:email")
    web = tags.get("website") or tags.get("contact:website") or tags.get("url")
    parts = [p for p in (phone, email, web) if p]
    out: dict = {}
    if phone:
        out["contactPhone"] = phone
    if email:
        out["contactEmail"] = email
    if web:
        out["contactWeb"] = web
    if parts:
        out["contact"] = " · ".join(parts)
    return out


def facility_properties(
    tags: Dict[str, str],
    coordinates: Point,
    osm_id: Optional[int] = None,
) -> dict:
    category = facility_category(tags)
    lon, lat = coordinates
    code = _facility_code(category, lon, lat)
    facility_id = f"OSM-{osm_id}" if osm_id is not None else f"AERIS-{code}"
    return {
        "category": category,
        "categoryLabel": facility_label(category),
        "name": tags.get("name") or facility_label(category),
        "priority": facility_priority(category),
        "source": "OpenStreetMap",
        "facilityId": facility_id,
        "facilityCode": code,
        "osmId": osm_id,
        **_facility_contact(tags),
    }


# Coarse spatial bucket (~30 m at PH latitudes) used to deduplicate UNNAMED
# facilities. OSM compounds (school/hospital campuses) often tag every
# building inside them — gate, classroom, library, canteen — and each becomes
# its own anonymous facility node. Without coarse bucketing, a single school
# can spawn 30+ "School / Campus" beacons stacked on top of each other.
_UNNAMED_FACILITY_BUCKET_DEG = 0.0003


def push_facility(
    facilities: List[dict],
    facility_keys: set,
    coordinates: Point,
    properties: dict,
) -> None:
    name = (properties.get("name") or "").strip().lower()
    label = (properties.get("categoryLabel") or "").strip().lower()
    is_unnamed = not name or name == label

    if is_unnamed:
        # Coarse bucket so every anonymous building inside a school/hospital
        # campus collapses to a single beacon at the campus centroid.
        key = "|".join(
            [
                str(properties.get("category", "other")),
                "<unnamed>",
                f"{coordinates[0] / _UNNAMED_FACILITY_BUCKET_DEG:.0f}",
                f"{coordinates[1] / _UNNAMED_FACILITY_BUCKET_DEG:.0f}",
            ]
        )
    else:
        # Named facilities use a fine ~1 m bucket so we don't drop genuinely
        # distinct landmarks that happen to share a name (e.g. "Barangay
        # Hall" appears once per barangay).
        key = "|".join(
            [
                str(properties.get("category", "other")),
                name,
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
        cat_counts: Dict[str, int] = {}
        for f in payload["facilities"]["features"]:
            c = f["properties"].get("category", "other")
            cat_counts[c] = cat_counts.get(c, 0) + 1
        cat_summary = ", ".join(
            f"{cat}={n}" for cat, n in sorted(cat_counts.items(), key=lambda kv: -kv[1])
        )
        print(
            f"  wrote {out_path.name}: "
            f"{len(payload['buildings']['features'])} buildings, "
            f"{len(payload['roads']['features'])} roads, "
            f"{len(payload['water']['features'])} water, "
            f"{len(payload['facilities']['features'])} facilities "
            f"({cat_summary})",
            flush=True,
        )
        if index < len(presets) - 1:
            time.sleep(6)


if __name__ == "__main__":
    main()
