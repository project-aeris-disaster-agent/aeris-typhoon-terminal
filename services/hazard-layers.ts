import type { Map as MLMap } from "maplibre-gl";
import { PAR_POLYGON } from "@/config/region";
import {
  FLOOD_LEVEL_STYLE,
  FLOOD_MGB_COLOR_EXPR,
  WATER_STYLE,
  type FloodLevel,
} from "@/config/flood-colors";
import {
  setFloodWireframe,
  setFloodWireframeOpacity,
  setFloodLevelVisible,
} from "@/services/map-scene";
import type { FloodPolygonFeature } from "@/services/three-scene";

export { FLOOD_LEVEL_STYLE };
export type { FloodLevel };

/**
 * Flood hazard map layers (MGB Geohazard / Flo-2D vector packs).
 *
 * The app used to also carry Project NOAH WMS raster layers (flood-5yr,
 * flood-25yr, flood-100yr, landslide) but that server returns no CORS
 * headers so every tile fetch failed from the browser, spamming the
 * console and destabilising the render loop. The MGB vector packs we
 * convert locally cover the same flood-susceptibility signal with much
 * higher fidelity and no cross-origin baggage, so NOAH was removed.
 *
 * Design goals:
 *   - One source of truth: the `/flood-hazard/index.json` manifest.
 *   - Two layers per pack (fill + outline). The 3D "flood slab" we had
 *     before duplicated signal already carried by the 3D building flood
 *     tint, so it was dropped.
 *   - UI radios derived from the unique `returnPeriod` values in the
 *     manifest, so adding more provinces is zero UI work.
 */

// Palette lives in `config/flood-colors.ts` (single source of truth); this
// module re-exports `FLOOD_LEVEL_STYLE` and the `FloodLevel` type for
// backwards compat with existing imports.

export const DEFAULT_HAZARD_OPACITY = 0.72;

// The MapLibre fill layer is kept as a faint area tint so flood zones remain
// identifiable at any zoom. The primary visual is the Three.js fat wireframe.
const FLOOD_FILL_OPACITY = 0.1;

// ---------------------------------------------------------------------------
// Manifest types.
// ---------------------------------------------------------------------------

export type FloodHazardPack = {
  province: string;
  provinceSlug: string;
  psgc: string;
  returnPeriod: string; // "5yr" | "25yr" | "100yr"
  path: string;
  bbox: [number, number, number, number];
  featureCounts: Record<FloodLevel, number>;
  vertices: number;
  sizeBytes: number;
  source: string;
};

type FloodHazardManifest = {
  generatedAt: string;
  simplifyToleranceDegrees: number;
  attribution: string;
  packs: FloodHazardPack[];
};

// ---------------------------------------------------------------------------
// Overlay (PAR boundary). Only other hazard-map-adjacent layer we own.
// ---------------------------------------------------------------------------

export type OverlayLayerId = "par-boundary";
export const OVERLAY_LAYERS: {
  id: OverlayLayerId;
  label: string;
  swatch: string;
}[] = [{ id: "par-boundary", label: "PAR Boundary", swatch: "#00d9ff" }];

export function ensureParLayer(map: MLMap) {
  if (!map.getSource("src-par")) {
    map.addSource("src-par", {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [PAR_POLYGON] },
        properties: {},
      },
    });
  }
  if (!map.getLayer("lyr-par-boundary")) {
    map.addLayer({
      id: "lyr-par-boundary",
      type: "line",
      source: "src-par",
      paint: {
        "line-color": "#00d9ff",
        "line-width": 1.5,
        "line-dasharray": [3, 2],
        "line-opacity": 0.7,
      },
    });
  }
}

export function setOverlayVisibility(
  map: MLMap,
  id: OverlayLayerId,
  visible: boolean,
) {
  const lid = id === "par-boundary" ? "lyr-par-boundary" : null;
  if (lid && map.getLayer(lid)) {
    map.setLayoutProperty(lid, "visibility", visible ? "visible" : "none");
  }
}

// ---------------------------------------------------------------------------
// Flood hazard layer registry.
// ---------------------------------------------------------------------------

const MGB_INDEX_URL = "/flood-hazard/index.json";

const sourceIdOf = (p: FloodHazardPack) =>
  `src-flood-${p.provinceSlug}-${p.returnPeriod}`;
const haloIdOf = (p: FloodHazardPack) =>
  `lyr-flood-halo-${p.provinceSlug}-${p.returnPeriod}`;
const fillIdOf = (p: FloodHazardPack) =>
  `lyr-flood-fill-${p.provinceSlug}-${p.returnPeriod}`;
const edgeIdOf = (p: FloodHazardPack) =>
  `lyr-flood-edge-${p.provinceSlug}-${p.returnPeriod}`;
const outlineIdOf = (p: FloodHazardPack) =>
  `lyr-flood-outline-${p.provinceSlug}-${p.returnPeriod}`;

// Per-map registry of loaded packs and the currently active return period.
const registry = new WeakMap<
  MLMap,
  { packs: FloodHazardPack[]; active: string | null }
>();

// Singleton fetches so the manifest + pack GeoJSON are loaded once even if
// `initMapLayers` and `LayerLegend`'s effect both call `ensureFloodHazardLayers`.
let manifestPromise: Promise<FloodHazardManifest | null> | null = null;
const packDataCache = new Map<string, GeoJSON.FeatureCollection>();
const packFetchInFlight = new Map<
  string,
  Promise<GeoJSON.FeatureCollection | null>
>();

async function fetchManifest(): Promise<FloodHazardManifest | null> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      try {
        // `no-cache` revalidates with the server via a conditional request;
        // never serve a stale pack list that would hide newly-added
        // provinces (seen during dev when Leyte landed after initial load).
        const r = await fetch(MGB_INDEX_URL, { cache: "no-cache" });
        return r.ok ? ((await r.json()) as FloodHazardManifest) : null;
      } catch {
        return null;
      }
    })();
  }
  return manifestPromise;
}

async function fetchPackData(
  path: string,
): Promise<GeoJSON.FeatureCollection | null> {
  const hit = packDataCache.get(path);
  if (hit) return hit;
  let p = packFetchInFlight.get(path);
  if (!p) {
    p = (async () => {
      try {
        // Pack GeoJSON is large (~1-8 MB) and immutable once generated,
        // so default HTTP caching is fine — the browser will store it and
        // revalidate via ETag on subsequent loads.
        const r = await fetch(path);
        if (!r.ok) return null;
        const data = (await r.json()) as GeoJSON.FeatureCollection;
        packDataCache.set(path, data);
        return data;
      } catch {
        return null;
      } finally {
        packFetchInFlight.delete(path);
      }
    })();
    packFetchInFlight.set(path, p);
  }
  return p;
}

// Data-driven level color expression for fill and outline layers —
// imported from the shared flood palette module.
const LEVEL_COLOR_EXPR = FLOOD_MGB_COLOR_EXPR;

function registerPack(
  map: MLMap,
  pack: FloodHazardPack,
  data: GeoJSON.FeatureCollection,
) {
  const srcId = sourceIdOf(pack);
  if (!map.getSource(srcId)) {
    map.addSource(srcId, {
      type: "geojson",
      data,
      attribution: pack.source,
    });
  }

  // Ensure water-noise texture is loaded for pattern fill
  if (!map.hasImage(WATER_STYLE.textureImage)) {
    map
      .loadImage(WATER_STYLE.texturePath)
      .then((img) => {
        if (img) {
          map.addImage(WATER_STYLE.textureImage, img.data, { sdf: false });
        }
      })
      .catch((err) => {
        console.warn(`Failed to load water noise texture: ${err}`);
      });
  }

  const beforeId = map.getLayer("lyr-osm-facility-labels")
    ? "lyr-osm-facility-labels"
    : undefined;

  // Layer 1: Halo — soft outer wash beneath the main fill
  if (!map.getLayer(haloIdOf(pack))) {
    map.addLayer(
      {
        id: haloIdOf(pack),
        type: "fill",
        source: srcId,
        layout: { visibility: "none" },
        paint: {
          "fill-color":
            LEVEL_COLOR_EXPR as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<string>,
          "fill-opacity": WATER_STYLE.halo.opacity,
          "fill-antialias": false,
        },
      },
      beforeId,
    );
  }

  // Layer 2: Main fill with water-noise pattern + level-based opacity
  if (!map.getLayer(fillIdOf(pack))) {
    map.addLayer(
      {
        id: fillIdOf(pack),
        type: "fill",
        source: srcId,
        layout: { visibility: "none" },
        paint: {
          // Apply water-noise pattern for organic texture
          "fill-pattern": WATER_STYLE.textureImage,
          // Tint color via a second translucent fill above the pattern
          "fill-color":
            LEVEL_COLOR_EXPR as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<string>,
          "fill-opacity": [
            "case",
            ["==", ["get", "level"], "high"],
            WATER_STYLE.fill.high.opacity,
            ["==", ["get", "level"], "medium"],
            WATER_STYLE.fill.medium.opacity,
            WATER_STYLE.fill.low.opacity,
          ] as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<number>,
          "fill-antialias": true,
        },
      },
      beforeId,
    );
  }

  // Layer 3: Feathered edge — replaces hard outline with line-blur
  if (!map.getLayer(edgeIdOf(pack))) {
    map.addLayer(
      {
        id: edgeIdOf(pack),
        type: "line",
        source: srcId,
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color":
            LEVEL_COLOR_EXPR as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<string>,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            ...WATER_STYLE.edge.widthZoom.flat(),
          ],
          "line-blur": WATER_STYLE.edge.blur,
          "line-opacity": WATER_STYLE.edge.opacity,
        },
      },
      beforeId,
    );
  }

  // Keep old outline layer for backward compat (optional, can remove later)
  if (!map.getLayer(outlineIdOf(pack))) {
    map.addLayer(
      {
        id: outlineIdOf(pack),
        type: "line",
        source: srcId,
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color":
            LEVEL_COLOR_EXPR as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<string>,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            0.6,
            12,
            1.4,
            15,
            2.0,
          ],
          "line-opacity": Math.min(1, DEFAULT_HAZARD_OPACITY + 0.2),
        },
      },
      beforeId,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Resolve the manifest and register the per-map pack metadata, but DO NOT
 * eagerly fetch pack GeoJSON bodies — those are expensive (1–8 MB each) and
 * only needed once the user opts into a specific return period.
 *
 * Pack bodies are loaded lazily by `setActiveFloodPeriod()` when the user
 * selects a period in the LayerLegend. The returned metadata array is
 * enough for `HazardMapPanel` and `LayerLegend` to render their province
 * and return-period lists.
 *
 * Safe to call multiple times — subsequent calls short-circuit on the
 * per-map registry.
 */
export async function ensureFloodHazardLayers(
  map: MLMap,
): Promise<FloodHazardPack[]> {
  const entry = registry.get(map);
  if (entry && entry.packs.length > 0) return entry.packs;

  const manifest = await fetchManifest();
  if (!manifest || manifest.packs.length === 0) {
    registry.set(map, { packs: [], active: null });
    return [];
  }

  registry.set(map, { packs: manifest.packs, active: null });
  return manifest.packs;
}

/**
 * Load the pack GeoJSON (network) and register its fill + outline layers
 * if not already registered. Idempotent — hitting the in-memory cache +
 * `map.getLayer` guard lets this be called repeatedly without duplicating
 * work.
 */
async function ensurePackRegistered(
  map: MLMap,
  pack: FloodHazardPack,
): Promise<GeoJSON.FeatureCollection | null> {
  const data = await fetchPackData(pack.path);
  if (!data) return null;
  registerPack(map, pack, data);
  return data;
}

/**
 * Show every pack whose `returnPeriod` matches, hide the rest. Pass `null`
 * to hide all flood hazard layers.
 *
 * Packs are loaded lazily: only the GeoJSON bodies matching the requested
 * `period` are fetched. Switching between periods caches what was already
 * downloaded.
 *
 * RENDERING OWNERSHIP
 * -------------------
 * MapLibre owns three layers per pack — halo, fill (with water-noise pattern),
 * and edge (feathered border) — that are both kept **hidden** while a Three.js
 * custom layer is present. The Three.js scene is the authoritative water-surface
 * renderer in 3D mode: it draws flood polygons as DECALS (depthTest off,
 * deterministic `renderOrder`) so the basemap raster painted onto the terrain
 * DEM cannot bleed through, regardless of camera pitch or terrain exaggeration.
 * Building meshes use a higher `renderOrder` and write depth, so they always
 * paint over the water surface even under rotation. See `FLOOD_RENDER_ORDER_*`
 * and `BUILDING_RENDER_ORDER` in `services/three-scene.ts`.
 *
 * The MapLibre layers exist so that:
 *   1. A 2D-mode fallback is available without touching Three.js.
 *   2. The GeoJSON source is always registered in the style (needed for
 *      setFilter-based level filtering even in 3D).
 *
 * Never make the MapLibre layers visible while Three.js flood patches
 * are also active — doing so would produce a double-draw on the same polygons.
 */
export async function setActiveFloodPeriod(
  map: MLMap,
  period: string | null,
): Promise<void> {
  const entry = registry.get(map);
  if (!entry) return;
  entry.active = period;

  // Hide all currently-registered layers up-front so the user sees an
  // immediate reaction while the new period's packs are being fetched.
  for (const pack of entry.packs) {
    for (const layerId of [haloIdOf(pack), fillIdOf(pack), edgeIdOf(pack), outlineIdOf(pack)]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "none");
      }
    }
  }

  if (period === null) {
    setFloodWireframe(map, [], false);
    return;
  }

  // Lazily load + register the packs matching the active period. Bail if
  // the user changed period mid-flight (active no longer equals our target).
  const matching = entry.packs.filter((p) => p.returnPeriod === period);
  await Promise.all(matching.map((p) => ensurePackRegistered(map, p)));
  if (entry.active !== period) return;

  // MapLibre layers are deliberately kept hidden — the Three.js scene owns
  // the water surface in 3D (see RENDERING OWNERSHIP in the JSDoc above).
  // Pushing features to setFloodWireframe() drives the elevated 3D patches;
  // the MapLibre layers remain as a 2D fallback registry only.
  const allFeatures: FloodPolygonFeature[] = [];
  for (const pack of matching) {
    const data = packDataCache.get(pack.path);
    if (!data) continue;
    for (const feat of data.features) {
      allFeatures.push(feat as FloodPolygonFeature);
    }
  }
  setFloodWireframe(map, allFeatures, true);
}

export function setFloodHazardOpacity(map: MLMap, opacity: number) {
  // The MapLibre fill stays at a fixed low opacity (FLOOD_FILL_OPACITY) so
  // only the Three.js fat wireframe responds to the user-controlled slider.
  setFloodWireframeOpacity(map, opacity);
}

/**
 * Show / hide flood polygons by susceptibility level.
 * Updates the MapLibre fill layer filter, the Three.js wireframe meshes,
 * 3D building tints, and the road/water flood impact overlay layers.
 */
export function setFloodLevelFilter(
  map: MLMap,
  visibleLevels: Record<"low" | "medium" | "high", boolean>,
) {
  const entry = registry.get(map);
  if (!entry) return;

  const allowed = (["low", "medium", "high"] as const).filter(
    (l) => visibleLevels[l],
  );

  // Filter expression for layers keyed by the "level" property (MGB flood layers).
  const levelFilter: unknown[] =
    allowed.length === 3
      ? ["has", "level"]
      : allowed.length === 0
        ? ["==", ["get", "level"], "__none__"]
        : ["in", ["get", "level"], ["literal", allowed]];

  // Update halo, fill, and edge layers (all respond to level filtering).
  for (const pack of entry.packs) {
    for (const layerId of [haloIdOf(pack), fillIdOf(pack), edgeIdOf(pack), outlineIdOf(pack)]) {
      if (map.getLayer(layerId) && typeof map.setFilter === "function") {
        map.setFilter(layerId, levelFilter as Parameters<typeof map.setFilter>[1]);
      }
    }
  }

  // Filter expression for scene layers keyed by the "floodLevel" property
  // (annotated OSM roads and water bodies).
  const floodLevelFilter: unknown[] =
    allowed.length === 3
      ? ["!=", ["coalesce", ["get", "floodLevel"], ""], ""]
      : allowed.length === 0
        ? ["==", ["get", "floodLevel"], "__none__"]
        : ["in", ["get", "floodLevel"], ["literal", allowed]];

  for (const layerId of ["lyr-osm-roads-flood", "lyr-osm-water-flood"] as const) {
    if (map.getLayer(layerId) && typeof map.setFilter === "function") {
      map.setFilter(layerId, floodLevelFilter as Parameters<typeof map.setFilter>[1]);
    }
  }

  // Mirror to Three.js wireframe meshes + trigger building re-colour.
  for (const lvl of ["low", "medium", "high"] as const) {
    setFloodLevelVisible(map, lvl, visibleLevels[lvl]);
  }
}

/**
 * Unique return periods present in the manifest, e.g. `["5yr"]`. Drives the
 * hazard radio list in `LayerLegend` so dropping more GeoJSON packs into
 * `public/flood-hazard/` is the only step needed to expose a new period.
 */
export function getFloodReturnPeriods(packs: FloodHazardPack[]): string[] {
  return Array.from(new Set(packs.map((p) => p.returnPeriod))).sort();
}

/** `"5yr"` → `"Flood (5-yr)"` (fallback: `"Flood (<period>)"`). */
export function formatReturnPeriodLabel(period: string): string {
  const m = /^(\d+)yr$/.exec(period);
  return m ? `Flood (${m[1]}-yr)` : `Flood (${period})`;
}

/** Initialise base overlay layers + kick off MGB flood pack loading. */
export function initMapLayers(map: MLMap) {
  ensureParLayer(map);
  void ensureFloodHazardLayers(map);
}
