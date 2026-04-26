"""
Annotate AERIS OSM scene packs with the MGB flood level each building / road /
water feature actually touches (highest of low / medium / high), so the
client can tint affected features without doing live geometry.

Runs a single spatial join per preset against the matching MGB flood hazard
packs (discovered from ``public/flood-hazard/index.json``) and writes
``properties.floodLevel`` = ``"low" | "medium" | "high"`` onto every feature
(buildings, roads, water polygons) that intersects a flood polygon. Features
with no intersection have the key removed so the output stays compact.

Each preset can cover multiple packs (e.g. Davao province has three
sub-regions). The *highest* flood rank across packs wins since users care
about worst-case impact for the area-in-view stats.

Add new preset->provinceSlug mappings to ``PRESET_TO_PACKS`` as more
regional scene packs and flood packs land.

Usage::

    python -u scripts/annotate_flood_impact.py          # all mapped presets
    python -u scripts/annotate_flood_impact.py cebu     # specific preset
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple

try:
    from shapely.geometry import shape
    from shapely.strtree import STRtree
except ImportError as exc:
    raise SystemExit(
        "Shapely is required. Install with: pip install shapely"
    ) from exc

ROOT = Path(__file__).resolve().parent.parent
SCENE_DIR = ROOT / "public" / "osm-context"
FLOOD_DIR = ROOT / "public" / "flood-hazard"

# Preset id -> flood hazard pack provinceSlug(s). Every slug listed here
# must exist in ``public/flood-hazard/index.json`` and match a preset id
# defined in ``services/map-scene.ts``. Rebuild presets as you add more
# regional scene packs.
PRESET_TO_PACKS: Dict[str, List[str]] = {
    "ncr": ["metromanila"],
    "bicol": ["albay"],
    "cebu": ["cebu"],
    "eastern-visayas": ["leyte"],
    "davao": ["davaodelnorte", "davaodelsur", "davaooriental"],
}

LEVEL_RANK = {"low": 1, "medium": 2, "high": 3}
RANK_TO_LEVEL = {1: "low", 2: "medium", 3: "high"}


def build_flood_index(pack_path: Path) -> Tuple[STRtree, List[int]]:
    """Return an STRtree of flood geometries plus their level ranks (parallel lists)."""
    pack = json.loads(pack_path.read_text(encoding="utf-8"))
    geoms = []
    ranks: List[int] = []
    for feat in pack.get("features", []):
        level = (feat.get("properties") or {}).get("level")
        rank = LEVEL_RANK.get(level, 0)
        if rank == 0:
            continue
        geom = shape(feat["geometry"])
        if geom.is_empty:
            continue
        # Split MultiPolygons so each tree entry is a single Polygon;
        # STRtree queries get tighter bboxes that way.
        if geom.geom_type == "MultiPolygon":
            for poly in geom.geoms:
                if not poly.is_empty:
                    geoms.append(poly)
                    ranks.append(rank)
        else:
            geoms.append(geom)
            ranks.append(rank)
    return STRtree(geoms), ranks


def max_flood_rank(
    geom,
    tree: STRtree,
    all_geoms: List,
    ranks: List[int],
) -> int:
    """Return the highest flood rank (1..3) touching ``geom``, or 0 if none."""
    if geom.is_empty:
        return 0
    # Shapely 2.x STRtree.query returns an ndarray of indices.
    idx = tree.query(geom)
    best = 0
    for i in idx:
        r = ranks[i]
        if r <= best:
            continue
        if all_geoms[i].intersects(geom):
            best = r
            if best == 3:
                break
    return best


def _resolve_pack_files(province_slugs: List[str]) -> List[Path]:
    """Map provinceSlugs to GeoJSON files via index.json so the annotator
    stays in sync with whatever the converter emitted (return periods may
    drift, new packs may land)."""
    index_path = FLOOD_DIR / "index.json"
    if not index_path.exists():
        raise FileNotFoundError(f"Missing manifest: {index_path}")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    slug_set = set(province_slugs)
    files: List[Path] = []
    for entry in index.get("packs", []):
        if entry.get("provinceSlug") in slug_set:
            fname = Path(entry["path"]).name  # e.g. "cebu-5yr.json"
            files.append(FLOOD_DIR / fname)
    return files


def annotate(preset: str, province_slugs: List[str]) -> Dict[str, int]:
    scene_path = SCENE_DIR / f"{preset}.json"
    if not scene_path.exists():
        raise FileNotFoundError(f"Missing scene pack: {scene_path}")

    scene = json.loads(scene_path.read_text(encoding="utf-8"))

    pack_files = _resolve_pack_files(province_slugs)
    if not pack_files:
        raise FileNotFoundError(
            f"No flood-hazard packs match slugs {province_slugs} in index.json"
        )

    # Combine indexes from every pack so we report worst-case rank per feature.
    trees: List[Tuple[STRtree, List, List[int]]] = []
    for pack_path in pack_files:
        if not pack_path.exists():
            raise FileNotFoundError(f"Missing flood pack file: {pack_path}")
        tree, ranks = build_flood_index(pack_path)
        trees.append((tree, list(tree.geometries), ranks))

    summary = {
        "buildings_low": 0, "buildings_medium": 0, "buildings_high": 0,
        "buildings_total": 0,
        "roads_low": 0, "roads_medium": 0, "roads_high": 0,
        "roads_total": 0,
        "water_low": 0, "water_medium": 0, "water_high": 0,
        "water_total": 0,
    }

    def annotate_collection(collection_key: str, kind: str) -> None:
        feats = (scene.get(collection_key) or {}).get("features") or []
        summary[f"{kind}_total"] = len(feats)
        for feat in feats:
            geom = shape(feat["geometry"])
            rank = 0
            for tree, all_geoms, ranks in trees:
                r = max_flood_rank(geom, tree, all_geoms, ranks)
                if r > rank:
                    rank = r
                    if rank == 3:
                        break
            props = feat.setdefault("properties", {})
            if rank > 0:
                level = RANK_TO_LEVEL[rank]
                props["floodLevel"] = level
                summary[f"{kind}_{level}"] += 1
            elif "floodLevel" in props:
                # Clean stale annotations from an earlier run.
                del props["floodLevel"]

    annotate_collection("buildings", "buildings")
    annotate_collection("roads", "roads")
    annotate_collection("water", "water")

    scene_path.write_text(
        json.dumps(scene, separators=(",", ":")), encoding="utf-8"
    )
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "preset_ids", nargs="*", help="Optional preset IDs to annotate"
    )
    args = parser.parse_args()

    targets = args.preset_ids or list(PRESET_TO_PACKS.keys())
    for preset in targets:
        slugs = PRESET_TO_PACKS.get(preset)
        if not slugs:
            print(f"skip {preset}: no flood pack configured", flush=True)
            continue
        print(f"\nAnnotating {preset} with {', '.join(slugs)}...", flush=True)
        summary = annotate(preset, slugs)
        b_total = summary["buildings_total"]
        r_total = summary["roads_total"]
        w_total = summary["water_total"]
        b_hit = (
            summary["buildings_low"]
            + summary["buildings_medium"]
            + summary["buildings_high"]
        )
        r_hit = (
            summary["roads_low"]
            + summary["roads_medium"]
            + summary["roads_high"]
        )
        w_hit = (
            summary["water_low"]
            + summary["water_medium"]
            + summary["water_high"]
        )
        print(
            f"  buildings: {b_hit}/{b_total} affected "
            f"(L{summary['buildings_low']} M{summary['buildings_medium']} H{summary['buildings_high']})",
            flush=True,
        )
        print(
            f"  roads:     {r_hit}/{r_total} affected "
            f"(L{summary['roads_low']} M{summary['roads_medium']} H{summary['roads_high']})",
            flush=True,
        )
        print(
            f"  water:     {w_hit}/{w_total} affected "
            f"(L{summary['water_low']} M{summary['water_medium']} H{summary['water_high']})",
            flush=True,
        )


if __name__ == "__main__":
    main()
