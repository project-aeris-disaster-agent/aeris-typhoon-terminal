"""
Convert PHL_msk_alt.vrt (ARC/INFO Grid) to Terrain-RGB PNG.

Input : public/dem/heightmap/PHL_msk_alt.vrt
Output: public/dem/ph-heightmap.png

Usage: python public/dem/convert_heightmap.py

Encoding: Mapbox Terrain-RGB
  height_m = -10000 + (R*65536 + G*256 + B) * 0.1
  => R,G,B = encode((height_m + 10000) * 10)
"""

import sys
from pathlib import Path
import numpy as np

try:
    import rasterio
    from rasterio.warp import reproject, Resampling, calculate_default_transform
    from rasterio.crs import CRS
    from PIL import Image
except ImportError as e:
    print(f"Missing package: {e}")
    print("Run: pip install rasterio numpy Pillow")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
SRC = SCRIPT_DIR / "heightmap" / "PHL_msk_alt.vrt"
OUT = SCRIPT_DIR / "ph-heightmap.png"

# Philippines bounding box in WGS84
PH_W, PH_S, PH_E, PH_N = 116.0, 4.5, 127.0, 21.5
DST_CRS  = CRS.from_epsg(3857)
OUT_SIZE = 2048          # px, square

def encode_terrain_rgb(elevation_m: np.ndarray) -> np.ndarray:
    """Encode elevation to Mapbox Terrain-RGB uint8 array (H x W x 3)."""
    # Clamp to valid range and shift
    v = np.clip(elevation_m, -10000, 1e5)
    encoded = np.round((v + 10000) * 10).astype(np.int64)
    r = (encoded >> 16) & 0xFF
    g = (encoded >> 8)  & 0xFF
    b = (encoded)       & 0xFF
    return np.stack([r, g, b], axis=-1).astype(np.uint8)

def main():
    if not SRC.exists():
        print(f"Source not found: {SRC}")
        print("Expected: public/dem/heightmap/PHL_msk_alt.vrt")
        sys.exit(1)

    print(f"Reading {SRC.name} ...")
    with rasterio.open(SRC) as src:
        print(f"  CRS       : {src.crs}")
        print(f"  Shape     : {src.height} x {src.width}")
        print(f"  Bands     : {src.count}")
        print(f"  NoData    : {src.nodata}")

        src_crs = src.crs
        # Compute transform for target extent in EPSG:3857
        from pyproj import Transformer
        tf = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
        x_min, y_min = tf.transform(PH_W, PH_S)
        x_max, y_max = tf.transform(PH_E, PH_N)

        x_res = (x_max - x_min) / OUT_SIZE
        y_res = (y_max - y_min) / OUT_SIZE
        from affine import Affine
        dst_transform = Affine(x_res, 0, x_min, 0, -y_res, y_max)

        dst_arr = np.zeros((OUT_SIZE, OUT_SIZE), dtype=np.float32)

        print(f"Reprojecting to EPSG:3857 at {OUT_SIZE}x{OUT_SIZE} ...")
        reproject(
            source=rasterio.band(src, 1),
            destination=dst_arr,
            src_transform=src.transform,
            src_crs=src_crs,
            dst_transform=dst_transform,
            dst_crs=DST_CRS,
            resampling=Resampling.bilinear,
            src_nodata=src.nodata,
            dst_nodata=np.nan,
        )

    nodata_mask = ~np.isfinite(dst_arr)
    dst_arr[nodata_mask] = 0.0   # ocean / nodata → sea level

    el_min = float(np.nanmin(dst_arr[~nodata_mask]))
    el_max = float(np.nanmax(dst_arr[~nodata_mask]))
    print(f"  Elevation range: {el_min:.0f}m – {el_max:.0f}m")

    print("Encoding to Terrain-RGB PNG ...")
    rgb = encode_terrain_rgb(dst_arr)
    img = Image.fromarray(rgb, "RGB")
    img.save(OUT, "PNG", optimize=False)

    size_mb = OUT.stat().st_size / 1e6
    print(f"\nDone! Saved to: {OUT}")
    print(f"File size: {size_mb:.1f} MB")
    print(f"Shape: {img.size[0]}x{img.size[1]} px")

if __name__ == "__main__":
    main()
