"""Extract Naga City barangay boundaries for the map overlay.

Geometry source: ``faeldon/philippines-json-maps`` (per-municipality GADM
high-resolution barangay polygons). The earlier curated PSA/NAMRIA release
(``bendlikeabamboo/barangay-boundaries-repository``) was simplified at ~550 m,
collapsing each barangay to a 4-5 point blob that left visible gaps between
neighbours; the GADM hi-res coverage tiles cleanly.

GADM carries no PSGC codes, so the stable PSA PSGC identifier is restored from
``NAGA_PSGC_BY_NAME`` below (joined on barangay name). This keeps the popup's
official code without re-downloading the 64 MB PSA dataset on every run.

One-time manual step (the source file is small, ~36 KB):

    1. Download the Naga City municipality file from faeldon, e.g.
       https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2011/geojson/barangays/hires/barangays-municity-370-nagacity.0.1.json
       (that file contains BOTH Naga City, Camarines Sur and City of Naga,
        Cebu -- this script keeps only the requested province).
    2. Run this script from the project root:

           python scripts/extract_naga_barangays.py --input barangays-municity-370-nagacity.0.1.json

       which writes ``public/admin-boundaries/naga-barangays.json``.

Geometry is emitted at full source resolution by default (coordinates rounded
to 5 decimals, ~1 m). ``--simplify <degrees>`` exists for shrinking much larger
extracts but is per-feature (NOT topology-aware), so any non-zero value can
re-open gaps between barangays -- use mapshaper/topojson if you ever need that.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

# GADM filter (faeldon schema). The Naga municipality file merges two cities;
# the province name disambiguates Camarines Sur (Bicol) from Cebu.
DEFAULT_CITY = "Naga City"
DEFAULT_PROVINCE = "Camarines Sur"
DEFAULT_OUTPUT = Path("public/admin-boundaries/naga-barangays.json")

# 0 disables simplification (default). Per-feature simplification is not
# topology-aware, so a non-zero value can open gaps between neighbours.
DEFAULT_SIMPLIFY_TOLERANCE_DEG = 0.0
COORD_PRECISION = 5

# PSA PSGC code per Naga City (Camarines Sur) barangay, keyed by the GADM
# ``NAME_3`` spelling. Restores the official identifier that GADM lacks.
NAGA_PSGC_BY_NAME = {
    "Abella": "0501724001",
    "Bagumbayan Norte": "0501724002",
    "Bagumbayan Sur": "0501724003",
    "Balatas": "0501724004",
    "Calauag": "0501724006",
    "Cararayan": "0501724007",
    "Carolina": "0501724008",
    "Concepcion Grande": "0501724009",
    "Concepcion Pequeño": "0501724010",
    "Dayangdang": "0501724011",
    "Del Rosario": "0501724012",
    "Dinaga": "0501724013",
    "Igualdad Interior": "0501724014",
    "Lerma": "0501724017",
    "Liboton": "0501724018",
    "Mabolo": "0501724019",
    "Pacol": "0501724020",
    "Panicuason": "0501724023",
    "Peñafrancia": "0501724024",
    "Sabang": "0501724025",
    "San Felipe": "0501724026",
    "San Francisco": "0501724027",
    "San Isidro": "0501724028",
    "Santa Cruz": "0501724029",
    "Tabuco": "0501724030",
    "Tinago": "0501724031",
    "Triangulo": "0501724032",
}

ATTRIBUTION = (
    "Barangay boundaries (c) GADM via faeldon/philippines-json-maps; "
    "PSGC codes (c) PSA."
)

try:  # Shapely is already a dependency of convert_flood_shapefile.py.
    from shapely.geometry import mapping, shape
    from shapely.validation import make_valid

    _HAS_SHAPELY = True
except Exception:  # pragma: no cover - optional dependency
    _HAS_SHAPELY = False


def round_coords(obj, precision: int = COORD_PRECISION):
    """Recursively round GeoJSON coordinate floats to keep file size small."""
    if isinstance(obj, float):
        return round(obj, precision)
    if isinstance(obj, list):
        return [round_coords(v, precision) for v in obj]
    if isinstance(obj, tuple):
        return [round_coords(v, precision) for v in obj]
    return obj


def clean_geometry(geometry: dict, simplify_tolerance: float) -> dict:
    """Repair (and optionally simplify) geometry with Shapely when available.

    Simplification is off by default. It is applied per feature and is NOT
    topology-aware, so a non-zero tolerance can pull shared borders apart and
    leave gaps between adjacent barangays.
    """
    if not _HAS_SHAPELY:
        return round_coords(geometry)
    try:
        geom = shape(geometry)
        if not geom.is_valid:
            geom = make_valid(geom)
        if simplify_tolerance > 0:
            geom = geom.simplify(simplify_tolerance, preserve_topology=True)
        return round_coords(mapping(geom))
    except Exception as err:  # fall back to raw geometry on any failure
        print(f"  warning: clean failed ({err}); using raw geometry", file=sys.stderr)
        return round_coords(geometry)


def build_feature(src: dict, simplify_tolerance: float) -> dict:
    props = src.get("properties", {}) or {}
    name = props.get("NAME_3")
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "psgc": NAGA_PSGC_BY_NAME.get(name, ""),
            "city": props.get("NAME_2"),
            "province": props.get("NAME_1"),
        },
        "geometry": clean_geometry(src.get("geometry"), simplify_tolerance),
    }


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Path to the faeldon Naga municipality GeoJSON.",
    )
    parser.add_argument(
        "--city",
        default=DEFAULT_CITY,
        help=f"GADM NAME_2 (city) to keep (default '{DEFAULT_CITY}').",
    )
    parser.add_argument(
        "--province",
        default=DEFAULT_PROVINCE,
        help=f"GADM NAME_1 (province) to keep (default '{DEFAULT_PROVINCE}').",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output GeoJSON path (default {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--simplify",
        type=float,
        default=DEFAULT_SIMPLIFY_TOLERANCE_DEG,
        help=(
            "Simplification tolerance in degrees (default 0 = off). "
            "Per-feature and NOT topology-aware: any non-zero value can open "
            "gaps between adjacent barangays."
        ),
    )
    args = parser.parse_args(argv)

    if not args.input.exists():
        print(f"error: input not found: {args.input}", file=sys.stderr)
        return 1

    print(f"Reading {args.input} ...")
    with args.input.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    features = data.get("features", [])
    matched = [
        f
        for f in features
        if (f.get("properties", {}) or {}).get("NAME_2") == args.city
        and (f.get("properties", {}) or {}).get("NAME_1") == args.province
    ]

    if not matched:
        print(
            f"error: no features matched NAME_2={args.city!r} NAME_1={args.province!r}",
            file=sys.stderr,
        )
        return 1

    print(f"Matched {len(matched)} barangays ({args.city}, {args.province}).")

    out_features = [build_feature(f, args.simplify) for f in matched]

    missing_psgc = [
        f["properties"]["name"] for f in out_features if not f["properties"]["psgc"]
    ]
    if missing_psgc:
        print(
            f"  warning: no PSGC for: {', '.join(missing_psgc)}",
            file=sys.stderr,
        )

    out = {
        "type": "FeatureCollection",
        "attribution": ATTRIBUTION,
        "features": out_features,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))

    size_kb = args.out.stat().st_size / 1024
    print(f"Wrote {len(out_features)} features to {args.out} ({size_kb:.1f} KB).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
