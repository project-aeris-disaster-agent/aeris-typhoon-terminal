# 3D Scene Packs

Static scene packs used by the 3D quick-view presets:

- `ncr.json`
- `bicol.json`
- `eastern-visayas.json`
- `cebu.json`
- `davao.json`

Each file contains a compact static GeoJSON payload with:

- representative 3D building footprints
- critical facilities
- major roads
- nearby water bodies

These packs keep the 3D preset views fast and reliable when live OSM enrichment
is slow or rate-limited. They are reference context for preset views, not live
per-viewport OSM queries.

The generator script lives at `scripts/generate_osm_scene_packs.py`.
