# Hazard Fallback Data

This app uses live Project NOAH / MGB WMS layers from `services/hazard-layers.ts`.
Static flood and landslide snapshots are not bundled here.

## Expected files

- `flood-5yr.geojson` — Project NOAH 5-year return period flood extent
- `flood-25yr.geojson` — 25-year flood extent
- `flood-100yr.geojson` — 100-year flood extent
- `landslide.geojson` — MGB landslide susceptibility zones

## Regenerating snapshots

Download from Project NOAH GeoServer or MGB then simplify with mapshaper:

```
mapshaper input.shp -simplify 10% -o format=geojson precision=0.00001 output.geojson
```

Keep each file under ~2 MB for fast PWA caching. Original download paths live in the project README.
