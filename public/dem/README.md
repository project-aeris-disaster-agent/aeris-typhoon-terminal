# Philippine Digital Elevation Model

The 3D map uses a local Terrain-RGB source:

- `ph-heightmap.png` — master Mapbox Terrain-RGB image of the Philippine archipelago
- `terrain-rgb/{z}/{x}/{y}.png` — XYZ terrain tiles generated from the master image for MapLibre `raster-dem`

Regenerate the tile pyramid after updating `ph-heightmap.png`:

```
python public/dem/generate_terrain_tiles.py
```

## Generating the heightmap

Source: SRTM 30m (USGS EarthExplorer) or Copernicus GLO-30.

1. Download SRTM tiles covering the bounding box `116E 4.5N` → `127E 21.5N`.
2. Merge and reproject to EPSG:3857 (Web Mercator) using gdalwarp:

   ```
   gdalwarp -t_srs EPSG:3857 -r bilinear -te_srs EPSG:4326 \
     -te 116 4.5 127 21.5 -ts 2048 2048 srtm_ph.tif warped.tif
   ```

3. Encode elevation to RGB (Mapbox Terrain-RGB format):

   ```
   rio rgbify -b -10000 -i 0.1 warped.tif ph-heightmap.png
   ```

Target file size: 3-8 MB. After the master PNG is updated, run the tile
generator so the 3D terrain view receives proper DEM tiles at runtime.
