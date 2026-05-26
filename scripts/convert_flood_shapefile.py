"""Convert MGB Geohazard flood shapefiles to web-ready GeoJSON.

Input layout (one folder per region under ``mapfiles/``). Two filename
conventions are supported — drop the shapefile set as MGB ships it and the
converter will figure it out:

    mapfiles/
        Albay/
            PH050500000_FH_5yr.{shp,shx,dbf,prj}     # PH<PSGC>_FH_<period>
        Manila/
            MetroManila_Flood_5year.{shp,shx,dbf,prj}  # <Name>_Flood_<N>year
        Davao/
            DavaoDelNorte_Flood_5year.{shp,shx,dbf,prj}
            DavaoDelSur_Flood_5year.{shp,shx,dbf,prj}
            DavaoOriental_Flood_5year.{shp,shx,dbf,prj}

One folder may contain multiple shapefiles (e.g. Davao's three sub-provinces);
each becomes its own pack in the output manifest.

MGB's flood-hazard maps encode the susceptibility in the ``Var`` column:

    Var = 1  Low       (shallow, <0.5 m)
    Var = 2  Medium    (0.5 - 1.5 m)
    Var = 3  High      (>1.5 m)

The raw shapefiles are enormous (Albay 5-yr ~60 MB with 1.85 M vertices) so we
aggressively simplify and drop sliver polygons before publishing to
``public/flood-hazard/``. A small ``index.json`` manifest is emitted so the
client can discover available provinces and return periods at runtime.

Run from the project root:

    python scripts/convert_flood_shapefile.py                # all folders
    python scripts/convert_flood_shapefile.py --province Manila
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

import shapefile
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.validation import make_valid

LEVEL_NAMES = {1: "low", 2: "medium", 3: "high"}
SIMPLIFY_TOLERANCE_DEG = 0.00025  # ~28 metres at the equator
MIN_AREA_DEG2 = 1e-7  # drop slivers smaller than ~1200 m^2 at equator

# Two MGB filename conventions in the wild:
#   PH<PSGC>_FH_<period>.shp            e.g. PH050500000_FH_5yr.shp
#   <AnyName>_Flood_<N>year.shp         e.g. MetroManila_Flood_5year.shp,
#                                           DavaoDelNorte_Flood_5year.shp
# We accept both so provinces can be dropped under mapfiles/<Region>/ as
# delivered, with no renaming required.
FILENAME_RES = [
    re.compile(r"^PH(?P<psgc>\d{9})_FH_(?P<period>[^.]+)\.shp$", re.IGNORECASE),
    re.compile(
        r"^(?P<name>.+?)_Flood_(?P<period>\d+(?:year|yr))\.shp$",
        re.IGNORECASE,
    ),
]


@dataclass
class FloodDataset:
    province: str        # folder name (display) e.g. "Davao", "Manila"
    region_label: str    # file-derived sub-region e.g. "DavaoDelNorte"
    province_slug: str   # url-safe slug used for the output filename
    psgc: str            # 9-digit PSGC if present in filename, else ""
    period: str          # normalised "5yr" | "25yr" | "100yr"
    shp_path: Path


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "province"


def _normalise_period(raw: str) -> str:
    """`5year` / `5yr` / `5YR` -> `5yr`."""
    raw = raw.lower().replace("year", "yr")
    return raw


def _parse_filename(shp_path: Path):
    for regex in FILENAME_RES:
        m = regex.match(shp_path.name)
        if m:
            groups = m.groupdict()
            period = _normalise_period(groups["period"])
            psgc = groups.get("psgc") or ""
            label = groups.get("name") or ""
            return label, psgc, period
    return None


def discover_datasets(mapfiles_dir: Path, province_filter: Optional[str]) -> List[FloodDataset]:
    datasets: List[FloodDataset] = []
    if not mapfiles_dir.exists():
        return datasets

    for province_dir in sorted(p for p in mapfiles_dir.iterdir() if p.is_dir()):
        if province_filter and province_dir.name.lower() != province_filter.lower():
            continue
        for shp_path in sorted(province_dir.glob("*.shp")):
            parsed = _parse_filename(shp_path)
            if not parsed:
                print(
                    f"  skipping {shp_path.name}: unrecognised file name",
                    file=sys.stderr,
                )
                continue
            label, psgc, period = parsed
            # If multiple shapefiles live under one folder (e.g. Davao has
            # DavaoDelNorte/Sur/Oriental), use the file-derived label for
            # the output slug so each pack gets a unique filename.
            region_label = label or province_dir.name
            slug_base = region_label if label else province_dir.name
            datasets.append(
                FloodDataset(
                    province=province_dir.name,
                    region_label=region_label,
                    province_slug=slugify(slug_base),
                    psgc=psgc,
                    period=period,
                    shp_path=shp_path,
                )
            )
    return datasets


def clean_geometry(geom: BaseGeometry) -> BaseGeometry:
    """Repair invalid polygons and simplify down to web-friendly resolution."""
    if geom.is_empty:
        return geom
    if not geom.is_valid:
        geom = make_valid(geom)
    geom = geom.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    return geom


def strip_small_parts(geom: BaseGeometry) -> Optional[BaseGeometry]:
    """Drop tiny polygons that add bytes but no pixels at the zooms we care about."""
    if geom.is_empty:
        return None

    if geom.geom_type == "Polygon":
        return geom if geom.area >= MIN_AREA_DEG2 else None

    if geom.geom_type in {"MultiPolygon", "GeometryCollection"}:
        parts = [
            part for part in geom.geoms
            if part.geom_type == "Polygon" and part.area >= MIN_AREA_DEG2
        ]
        if not parts:
            return None
        if len(parts) == 1:
            return parts[0]
        from shapely.geometry import MultiPolygon

        return MultiPolygon(parts)

    return None


def round_coords(obj, precision: int = 5):
    """Recursively round GeoJSON coordinate floats to keep file size reasonable."""
    if isinstance(obj, float):
        return round(obj, precision)
    if isinstance(obj, list):
        return [round_coords(v, precision) for v in obj]
    if isinstance(obj, tuple):
        return tuple(round_coords(v, precision) for v in obj)
    if isinstance(obj, dict):
        return {k: round_coords(v, precision) for k, v in obj.items()}
    return obj


def _humanise(label: str) -> str:
    """`DavaoDelNorte` -> `Davao Del Norte`; already-spaced labels pass through."""
    if " " in label:
        return label
    return re.sub(r"(?<!^)(?=[A-Z])", " ", label)


def convert(dataset: FloodDataset, output_dir: Path) -> dict:
    display_name = _humanise(dataset.region_label)
    print(
        f"\nProcessing {display_name} ({dataset.psgc or 'no-psgc'}) "
        f"/ {dataset.period} -> {dataset.shp_path.name}",
        flush=True,
    )
    reader = shapefile.Reader(str(dataset.shp_path))
    print(
        f"  records: {len(reader)}  shape: {reader.shapeTypeName}  bbox: {reader.bbox}",
        flush=True,
    )

    from shapely.geometry import MultiPolygon, Polygon

    features = []
    level_counts = {"low": 0, "medium": 0, "high": 0}
    raw_vertices = 0
    simplified_vertices = 0

    for sr in reader.shapeRecords():
        var_value = int(sr.record["Var"])
        level = LEVEL_NAMES.get(var_value)
        if level is None:
            print(f"  warn: skipping unknown Var={var_value}", flush=True)
            continue

        raw_geom = shape(sr.shape.__geo_interface__)
        raw_vertices += count_vertices(raw_geom)

        # Iterate individual polygons from the MultiPolygon so simplify stays
        # fast per-shape (calling simplify on 90k-part multipolygons is O(n)
        # per vertex and locks Python for minutes).
        if raw_geom.geom_type == "Polygon":
            polys = [raw_geom]
        elif raw_geom.geom_type == "MultiPolygon":
            polys = list(raw_geom.geoms)
        else:
            polys = []

        total = len(polys)
        print(f"  {level}: simplifying {total} polygons...", flush=True)

        kept: list[Polygon] = []
        progress_step = max(1, total // 10)
        for idx, poly in enumerate(polys):
            if poly.is_empty:
                continue
            if not poly.is_valid:
                poly = make_valid(poly)
                if poly.is_empty:
                    continue
                if poly.geom_type == "MultiPolygon":
                    for sub in poly.geoms:
                        if sub.geom_type == "Polygon" and sub.area >= MIN_AREA_DEG2:
                            simplified = sub.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
                            if not simplified.is_empty and simplified.area >= MIN_AREA_DEG2:
                                kept.append(simplified)
                    continue
                if poly.geom_type != "Polygon":
                    continue
            if poly.area < MIN_AREA_DEG2:
                continue
            simplified = poly.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
            if simplified.is_empty or simplified.area < MIN_AREA_DEG2:
                continue
            kept.append(simplified)
            if idx and idx % progress_step == 0:
                pct = int(100 * idx / total)
                print(f"    {pct}% ({idx}/{total}, kept {len(kept)})", flush=True)

        if not kept:
            continue
        merged = kept[0] if len(kept) == 1 else MultiPolygon(kept)
        simplified_vertices += count_vertices(merged)
        level_counts[level] += len(kept)

        feature = {
            "type": "Feature",
            "geometry": round_coords(mapping(merged)),
            "properties": {
                "level": level,
                "var": var_value,
                "returnPeriod": dataset.period,
                "province": display_name,
                "psgc": dataset.psgc,
                "source": "MGB Geohazard Maps (Flo-2D)",
            },
        }
        features.append(feature)
        print(
            f"  {level}: kept {len(kept)} / {total} polygons after simplify",
            flush=True,
        )

    collection = {"type": "FeatureCollection", "features": features}

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{dataset.province_slug}-{dataset.period}.json"
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(collection, handle, separators=(",", ":"), ensure_ascii=False)

    size_kb = out_path.stat().st_size / 1024
    reduction = (
        (1 - simplified_vertices / raw_vertices) * 100 if raw_vertices else 0.0
    )
    print(
        f"  wrote {out_path.relative_to(output_dir.parent.parent)} "
        f"({size_kb:.0f} KB, {simplified_vertices} verts, {reduction:.1f}% reduction)"
    )

    return {
        "province": display_name,
        "provinceSlug": dataset.province_slug,
        "psgc": dataset.psgc,
        "returnPeriod": dataset.period,
        "path": f"/flood-hazard/{out_path.name}",
        "bbox": list(reader.bbox),
        "featureCounts": level_counts,
        "vertices": simplified_vertices,
        "sizeBytes": out_path.stat().st_size,
        "source": "MGB Geohazard Maps (Flo-2D)",
    }


def count_vertices(geom: BaseGeometry) -> int:
    if geom.is_empty:
        return 0
    if geom.geom_type == "Polygon":
        exterior = len(geom.exterior.coords)
        interiors = sum(len(ring.coords) for ring in geom.interiors)
        return exterior + interiors
    if geom.geom_type == "MultiPolygon":
        return sum(count_vertices(p) for p in geom.geoms)
    if geom.geom_type == "GeometryCollection":
        return sum(count_vertices(p) for p in geom.geoms)
    return 0


def write_index(entries: Iterable[dict], output_dir: Path) -> None:
    """Merge new entries into the existing manifest so single-province runs
    don't drop unrelated packs (e.g. converting Cebu shouldn't delete Albay)."""
    path = output_dir / "index.json"

    existing: List[dict] = []
    if path.exists():
        try:
            prior = json.loads(path.read_text(encoding="utf-8"))
            existing = list(prior.get("packs", []))
        except (json.JSONDecodeError, OSError):
            existing = []

    new_entries = list(entries)
    # Key on (provinceSlug, returnPeriod) so re-running the script for a
    # folder with multiple sub-regions (e.g. Davao's 3 provinces) doesn't
    # drop siblings from the manifest.
    new_keys = {(e["provinceSlug"], e["returnPeriod"]) for e in new_entries}
    merged = [
        e for e in existing
        if (e.get("provinceSlug"), e.get("returnPeriod")) not in new_keys
    ] + new_entries

    index = {
        "generatedAt": _now_iso(),
        "simplifyToleranceDegrees": SIMPLIFY_TOLERANCE_DEG,
        "attribution": "Mines and Geosciences Bureau (MGB) Philippines",
        "packs": sorted(
            merged, key=lambda e: (e["province"], e["returnPeriod"])
        ),
    }
    with path.open("w", encoding="utf-8") as handle:
        json.dump(index, handle, indent=2, ensure_ascii=False)
    print(f"\nWrote manifest: {path}")


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--province",
        help="Only convert the named province folder (case-insensitive, e.g. Albay).",
    )
    parser.add_argument(
        "--mapfiles",
        type=Path,
        default=Path("mapfiles"),
        help="Root folder containing <Province>/PH<PSGC>_FH_<period>.shp (default: mapfiles).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/flood-hazard"),
        help="Destination for GeoJSON + index.json (default: public/flood-hazard).",
    )
    args = parser.parse_args()

    datasets = discover_datasets(args.mapfiles, args.province)
    if not datasets:
        print(
            f"No MGB flood hazard shapefiles found under {args.mapfiles}.",
            file=sys.stderr,
        )
        return 1

    entries = [convert(ds, args.output) for ds in datasets]
    write_index(entries, args.output)
    print(f"\nDone. Converted {len(entries)} dataset(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
