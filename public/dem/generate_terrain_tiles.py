"""
Slice `ph-heightmap.png` into WebMercator Terrain-RGB XYZ tiles for MapLibre.

Input : public/dem/ph-heightmap.png
Output: public/dem/terrain-rgb/{z}/{x}/{y}.png

Usage:
    python public/dem/generate_terrain_tiles.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).parent
SRC = SCRIPT_DIR / "ph-heightmap.png"
OUT_DIR = SCRIPT_DIR / "terrain-rgb"

PH_W, PH_S, PH_E, PH_N = 116.0, 4.5, 127.0, 21.5
MAX_ZOOM = 8
TILE_SIZE = 256
ORIGIN_SHIFT = 20037508.342789244
SEA_LEVEL_RGB = (1, 134, 160)


def lon_to_merc_x(lon: float) -> float:
    return lon * ORIGIN_SHIFT / 180.0


def lat_to_merc_y(lat: float) -> float:
    lat = max(min(lat, 85.05112878), -85.05112878)
    rad = math.radians(lat)
    return ORIGIN_SHIFT * math.log(math.tan(math.pi / 4.0 + rad / 2.0)) / math.pi


def lon_to_tile_x(lon: float, z: int) -> int:
    n = 2**z
    return int((lon + 180.0) / 360.0 * n)


def lat_to_tile_y(lat: float, z: int) -> int:
    n = 2**z
    lat_rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return int(y)


def merc_to_source_px(x: float, y: float, width: int, height: int) -> tuple[float, float]:
    px = (x - BBOX_LEFT) / (BBOX_RIGHT - BBOX_LEFT) * width
    py = (BBOX_TOP - y) / (BBOX_TOP - BBOX_BOTTOM) * height
    return px, py


def merc_to_tile_px(x: float, y: float, left: float, right: float, bottom: float, top: float) -> tuple[float, float]:
    px = (x - left) / (right - left) * TILE_SIZE
    py = (top - y) / (top - bottom) * TILE_SIZE
    return px, py


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing source PNG: {SRC}")

    image = Image.open(SRC).convert("RGB")
    width, height = image.size

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    count = 0
    for z in range(MAX_ZOOM + 1):
        x_min = max(0, lon_to_tile_x(PH_W, z))
        x_max = min(2**z - 1, lon_to_tile_x(PH_E, z))
        y_min = max(0, lat_to_tile_y(PH_N, z))
        y_max = min(2**z - 1, lat_to_tile_y(PH_S, z))

        n = 2**z
        world_span = ORIGIN_SHIFT * 2.0

        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                left = -ORIGIN_SHIFT + world_span * (x / n)
                right = -ORIGIN_SHIFT + world_span * ((x + 1) / n)
                top = ORIGIN_SHIFT - world_span * (y / n)
                bottom = ORIGIN_SHIFT - world_span * ((y + 1) / n)

                inter_left = max(left, BBOX_LEFT)
                inter_right = min(right, BBOX_RIGHT)
                inter_top = min(top, BBOX_TOP)
                inter_bottom = max(bottom, BBOX_BOTTOM)

                if inter_left >= inter_right or inter_bottom >= inter_top:
                    continue

                sx0, sy0 = merc_to_source_px(inter_left, inter_top, width, height)
                sx1, sy1 = merc_to_source_px(inter_right, inter_bottom, width, height)
                dx0, dy0 = merc_to_tile_px(inter_left, inter_top, left, right, bottom, top)
                dx1, dy1 = merc_to_tile_px(inter_right, inter_bottom, left, right, bottom, top)

                source_box = (
                    max(0, int(math.floor(sx0))),
                    max(0, int(math.floor(sy0))),
                    min(width, int(math.ceil(sx1))),
                    min(height, int(math.ceil(sy1))),
                )
                dest_box = (
                    max(0, int(math.floor(dx0))),
                    max(0, int(math.floor(dy0))),
                    min(TILE_SIZE, int(math.ceil(dx1))),
                    min(TILE_SIZE, int(math.ceil(dy1))),
                )

                if source_box[0] >= source_box[2] or source_box[1] >= source_box[3]:
                    continue
                if dest_box[0] >= dest_box[2] or dest_box[1] >= dest_box[3]:
                    continue

                tile = Image.new("RGB", (TILE_SIZE, TILE_SIZE), SEA_LEVEL_RGB)
                crop = image.crop(source_box)
                resized = crop.resize(
                    (dest_box[2] - dest_box[0], dest_box[3] - dest_box[1]),
                    Image.Resampling.BILINEAR,
                )
                tile.paste(resized, dest_box[:2])

                output_dir = OUT_DIR / str(z) / str(x)
                output_dir.mkdir(parents=True, exist_ok=True)
                tile.save(output_dir / f"{y}.png", "PNG", optimize=True)
                count += 1

    print(f"Generated {count} terrain tiles in {OUT_DIR}")


BBOX_LEFT = lon_to_merc_x(PH_W)
BBOX_RIGHT = lon_to_merc_x(PH_E)
BBOX_BOTTOM = lat_to_merc_y(PH_S)
BBOX_TOP = lat_to_merc_y(PH_N)


if __name__ == "__main__":
    main()
