# Administrative Boundaries

Static GeoJSON overlays for Philippine administrative boundaries. Currently
limited to **Naga City (Camarines Sur)** barangays.

## Files

| File                   | Contents                                          |
| ---------------------- | ------------------------------------------------- |
| `naga-barangays.json`  | 27 barangay polygons for Naga City, Camarines Sur |

Each feature carries:

| Property   | Example            | Meaning                          |
| ---------- | ------------------ | -------------------------------- |
| `name`     | `"Abella"`         | Barangay name (GADM `NAME_3`)    |
| `psgc`     | `"0501724001"`     | 10-digit PSGC barangay code      |
| `city`     | `"Naga City"`      | Parent city (GADM `NAME_2`)      |
| `province` | `"Camarines Sur"`  | Parent province (GADM `NAME_1`)  |

The client loads this file in [services/admin-boundaries.ts](../../services/admin-boundaries.ts)
and registers a fill + outline + label layer with a click/hover popup.

## Why GADM (faeldon) and not the PSA/NAMRIA release

The first cut used the curated PSA/NAMRIA release
(`bendlikeabamboo/barangay-boundaries-repository`), but every published variant
there is simplified at ~550 m (`t0p005`), collapsing each barangay to a 4-5
point blob that left visible gaps between neighbours. The GADM high-resolution
coverage from `faeldon/philippines-json-maps` has finer geometry that tiles
cleanly. GADM lacks PSGC codes, so those are restored from the PSA dataset via a
name-keyed lookup baked into the extraction script.

## Regenerating

1. Download the Naga City municipality file from faeldon (the file holds BOTH
   Naga City, Camarines Sur and City of Naga, Cebu; the script keeps only the
   requested province):

   ```
   https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2011/geojson/barangays/hires/barangays-municity-370-nagacity.0.1.json
   ```

2. From the project root:

   ```bash
   python scripts/extract_naga_barangays.py --input barangays-municity-370-nagacity.0.1.json
   ```

   Use `--city`/`--province` to extract a different LGU.

## Attribution

Barangay boundaries (c) **GADM**, via `faeldon/philippines-json-maps`. PSGC
codes (c) **Philippine Statistics Authority (PSA)**. Note GADM data is licensed
for non-commercial use; review GADM's terms before commercial redistribution.
