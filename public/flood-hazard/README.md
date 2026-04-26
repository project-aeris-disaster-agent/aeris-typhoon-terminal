# Flood Hazard Polygons (MGB Geohazard Maps)

Static GeoJSON packs derived from the Mines and Geosciences Bureau (MGB)
Flo-2D flood-hazard shapefiles. The client loads `index.json` at startup
and registers one MapLibre `fill` + `line` layer per pack; the hazard
radio list is derived from the set of unique `returnPeriod` values in the
manifest, so adding a new province is zero UI work.

## Data flow

```
mapfiles/<Region>/*.{shp,shx,dbf,prj}  ──┐
                                         ▼
                     scripts/convert_flood_shapefile.py
                                         │
                                         ▼
        public/flood-hazard/<slug>-<period>.json  (+ index.json)
                                         │
                                         ▼
              services/hazard-layers.ts  (fill + outline per pack)
                                         │
                                         ▼
                components/LayerLegend.tsx  (radios by period)
```

## Feature schema

Each feature carries:

| Property       | Example                         | Meaning                                     |
| -------------- | ------------------------------- | ------------------------------------------- |
| `level`        | `"low"` / `"medium"` / `"high"` | Derived from MGB's `Var` column (1 / 2 / 3) |
| `var`          | `1`, `2`, `3`                   | Raw MGB susceptibility code                 |
| `returnPeriod` | `"5yr"` / `"25yr"` / `"100yr"`  | Rainfall return period modelled             |
| `province`     | `"Cebu"`, `"Metro Manila"`      | Human-readable region label                 |
| `psgc`         | `"072200000"` or `""`           | 9-digit province PSGC if present            |
| `source`       | `"MGB Geohazard Maps (Flo-2D)"` | Attribution                                 |

Styling follows MGB's printed hazard map palette: Low = yellow (`#fde047`),
Medium = orange (`#fb923c`), High = red (`#dc2626`).

## Adding more regions

1. Drop the shapefile set (`.shp` / `.shx` / `.dbf` / `.prj`) under
   `mapfiles/<Region>/`. Both MGB naming conventions are recognised:

   - `PH<PSGC>_FH_<period>.shp` (e.g. `PH050500000_FH_5yr.shp`)
   - `<Name>_Flood_<N>year.shp`  (e.g. `MetroManila_Flood_5year.shp`)

   A single folder may contain multiple shapefiles — each becomes its own
   pack (Davao ships three sub-provinces this way).

2. Run the converter from the project root:

   ```bash
   python scripts/convert_flood_shapefile.py                # everything
   python scripts/convert_flood_shapefile.py --province Manila   # one folder
   ```

3. Commit the emitted `public/flood-hazard/<slug>-<period>.json` files
   and the refreshed `index.json`. The hazard radio for that period
   auto-appears in the map UI on next reload.

The script simplifies geometry with Shapely (~25 m tolerance) and drops
sliver polygons smaller than ~1200 m² to keep file sizes web-friendly.
Typical reduction: **90–93% fewer vertices** (Albay 60 MB → 2 MB, Manila
33 MB → 3.3 MB) with no visible loss at zoom ≤ 15.

## (Optional) Per-building flood tagging

To tint individual 3D buildings and roads with the hazard level they sit
inside, annotate the OSM context packs with a spatial join:

```bash
python scripts/annotate_flood_impact.py                     # all presets
python scripts/annotate_flood_impact.py cebu                # one preset
```

This writes `properties.floodLevel` onto each intersected feature in
`public/osm-context/<preset>.json`. The client surfaces those tags as an
"Affected in view" count and tints the 3D buildings + roads when a flood
period is active.
