import type { Map as MLMap } from "maplibre-gl";
import { layerBeforeBasemapLabels } from "@/config/map-layers";
import { PAR_POLYGON } from "@/config/region";
import {
  FLOOD_LEVEL_STYLE,
  FLOOD_MGB_COLOR_EXPR,
  WATER_STYLE,
  type FloodLevel,
} from "@/config/flood-colors";
import type { FloodVisualizationSettings } from "@/config/flood-visualization";
import {
  getFloodPolygonOpacity,
  getFloodVisualizationSettings,
  setFloodWireframe,
  setFloodWireframeOpacity,
  setFloodLevelVisible,
} from "@/services/map-scene";
import { pinSatelliteRastersToTop } from "@/services/satellite-frames";
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
 *   - Four layers per pack (halo + pattern + tint fill + soft edge). In 2D,
 *     only tint + edge are shown (halo wash and noise pattern hidden). The 3D
 *     "flood slab" we had before duplicated signal already carried by the 3D
 *     building flood tint, so it was dropped.
 *   - UI radios derived from the unique `returnPeriod` values in the
 *     manifest, so adding more provinces is zero UI work.
 */

// Palette lives in `config/flood-colors.ts` (single source of truth); this
// module re-exports `FLOOD_LEVEL_STYLE` and the `FloodLevel` type for
// backwards compat with existing imports.

export const DEFAULT_HAZARD_OPACITY = 0.72;

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
    map.addLayer(
      {
        id: "lyr-par-boundary",
        type: "line",
        source: "src-par",
        paint: {
          "line-color": "#00d9ff",
          "line-width": 1.5,
          "line-dasharray": [3, 2],
          "line-opacity": 0.7,
        },
      },
      layerBeforeBasemapLabels(map),
    );
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
const patternIdOf = (p: FloodHazardPack) =>
  `lyr-flood-pattern-${p.provinceSlug}-${p.returnPeriod}`;
const fillIdOf = (p: FloodHazardPack) =>
  `lyr-flood-fill-${p.provinceSlug}-${p.returnPeriod}`;
const edgeIdOf = (p: FloodHazardPack) =>
  `lyr-flood-edge-${p.provinceSlug}-${p.returnPeriod}`;

// Per-map registry of loaded packs and the currently active return period.
const registry = new WeakMap<
  MLMap,
  { packs: FloodHazardPack[]; active: string | null }
>();
const ensureLayersInFlight = new WeakMap<MLMap, Promise<FloodHazardPack[]>>();

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

// Data-driven level color expression for fill / line layers —
// imported from the shared flood palette module.
const LEVEL_COLOR_EXPR = FLOOD_MGB_COLOR_EXPR;

const WIRE_COLOR_EXPR_FOR_SETTINGS = (
  s: FloodVisualizationSettings,
): import("maplibre-gl").DataDrivenPropertyValueSpecification<string> =>
  [
    "match",
    ["get", "level"],
    "high",
    s.wireframeColors.high,
    "medium",
    s.wireframeColors.medium,
    "low",
    s.wireframeColors.low,
    s.wireframeColors.low,
  ] as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<string>;

/**
 * Push water color / opacity / wire colors to MapLibre flood layers (2D path).
 * Safe when layers are missing (e.g. packs not registered yet).
 */
export function applyFloodMapLibreVisualization(
  map: MLMap,
  settings: FloodVisualizationSettings,
) {
  const entry = registry.get(map);
  if (!entry) return;
  const sliderMul = Math.max(0, Math.min(1, getFloodPolygonOpacity(map)));
  const w = Math.max(0, Math.min(1, settings.waterOpacity));

  const tintOpacityExpr: unknown[] = [
    "*",
    sliderMul,
    w,
    [
      "case",
      ["==", ["get", "level"], "high"],
      WATER_STYLE.tint.high.opacity,
      ["==", ["get", "level"], "medium"],
      WATER_STYLE.tint.medium.opacity,
      ["==", ["get", "level"], "low"],
      WATER_STYLE.tint.low.opacity,
      WATER_STYLE.tint.low.opacity,
    ],
  ];

  const haloOp = Math.min(1, WATER_STYLE.halo.opacity * w * sliderMul);
  const patternOp = Math.min(1, WATER_STYLE.pattern.opacity * w * sliderMul);
  const edgeOp = Math.min(
    1,
    WATER_STYLE.edge.opacity * settings.wireframeBrightness * sliderMul,
  );

  for (const pack of entry.packs) {
    const halo = haloIdOf(pack);
    if (map.getLayer(halo) && typeof map.setPaintProperty === "function") {
      map.setPaintProperty(halo, "fill-color", settings.waterColor);
      map.setPaintProperty(halo, "fill-opacity", haloOp);
    }
    const pattern = patternIdOf(pack);
    if (map.getLayer(pattern) && typeof map.setPaintProperty === "function") {
      map.setPaintProperty(pattern, "fill-opacity", patternOp);
    }
    const fill = fillIdOf(pack);
    if (map.getLayer(fill) && typeof map.setPaintProperty === "function") {
      map.setPaintProperty(fill, "fill-color", settings.waterColor);
      map.setPaintProperty(
        fill,
        "fill-opacity",
        tintOpacityExpr as Parameters<typeof map.setPaintProperty>[2],
      );
    }
    const edge = edgeIdOf(pack);
    if (map.getLayer(edge) && typeof map.setPaintProperty === "function") {
      map.setPaintProperty(
        edge,
        "line-color",
        WIRE_COLOR_EXPR_FOR_SETTINGS(settings),
      );
      map.setPaintProperty(edge, "line-opacity", edgeOp);
    }
  }
}

/**
 * Load the tileable noise PNG into the style before any `fill-pattern` layer
 * references it — otherwise MapLibre never draws the pattern.
 */
async function ensureWaterNoiseImage(map: MLMap): Promise<void> {
  if (typeof map.hasImage !== "function") return;
  if (map.hasImage(WATER_STYLE.textureImage)) return;
  if (typeof map.loadImage !== "function" || typeof map.addImage !== "function")
    return;
  try {
    const res = await map.loadImage(WATER_STYLE.texturePath);
    if (res && !map.hasImage(WATER_STYLE.textureImage)) {
      map.addImage(WATER_STYLE.textureImage, res.data, { sdf: false });
    }
  } catch (err) {
    console.warn(`Failed to load water noise texture: ${err}`);
  }
}

async function registerPack(
  map: MLMap,
  pack: FloodHazardPack,
  data: GeoJSON.FeatureCollection,
) {
  await ensureWaterNoiseImage(map);

  const srcId = sourceIdOf(pack);
  if (!map.getSource(srcId)) {
    map.addSource(srcId, {
      type: "geojson",
      data,
      attribution: pack.source,
    });
  }

  const beforeId = layerBeforeBasemapLabels(map);

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

  // Layer 2: Noise pattern only (MapLibre ignores fill-color when fill-pattern is set).
  if (!map.getLayer(patternIdOf(pack))) {
    map.addLayer(
      {
        id: patternIdOf(pack),
        type: "fill",
        source: srcId,
        layout: { visibility: "none" },
        paint: {
          "fill-pattern": WATER_STYLE.textureImage,
          "fill-opacity": WATER_STYLE.pattern.opacity,
          "fill-antialias": true,
        },
      },
      beforeId,
    );
  }

  // Layer 3: Translucent level tint (2D omits halo + pattern above for a flat read)
  if (!map.getLayer(fillIdOf(pack))) {
    map.addLayer(
      {
        id: fillIdOf(pack),
        type: "fill",
        source: srcId,
        layout: { visibility: "none" },
        paint: {
          "fill-color":
            LEVEL_COLOR_EXPR as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<string>,
          "fill-opacity": [
            "case",
            ["==", ["get", "level"], "high"],
            WATER_STYLE.tint.high.opacity,
            ["==", ["get", "level"], "medium"],
            WATER_STYLE.tint.medium.opacity,
            WATER_STYLE.tint.low.opacity,
          ] as unknown as import("maplibre-gl").DataDrivenPropertyValueSpecification<number>,
          "fill-antialias": true,
        },
      },
      beforeId,
    );
  }

  // Layer 4: Feathered edge — soft border via line-blur
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

  applyFloodMapLibreVisualization(map, getFloodVisualizationSettings(map));
  pinSatelliteRastersToTop(map);
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
 * enough for `LayerLegend` to render province and return-period lists.
 *
 * Safe to call multiple times — subsequent calls short-circuit on the
 * per-map registry.
 */
export async function ensureFloodHazardLayers(
  map: MLMap,
): Promise<FloodHazardPack[]> {
  const entry = registry.get(map);
  if (entry && entry.packs.length > 0) return entry.packs;

  const inFlight = ensureLayersInFlight.get(map);
  if (inFlight) return inFlight;

  const resolveOnce = (async () => {
    const manifest = await fetchManifest();
    if (!manifest || manifest.packs.length === 0) {
      registry.set(map, { packs: [], active: null });
      return [];
    }

    registry.set(map, { packs: manifest.packs, active: null });
    return manifest.packs;
  })();
  ensureLayersInFlight.set(map, resolveOnce);

  try {
    return await resolveOnce;
  } finally {
    ensureLayersInFlight.delete(map);
  }
}

/**
 * Load the pack GeoJSON (network) and register halo / pattern / tint / edge layers
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
  await registerPack(map, pack, data);
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
 * MapLibre owns four layers per pack — halo, pattern (noise tile), tint fill,
 * and edge (feathered border).
 *
 * **2D (`mapMode === "2d"`)** — Only **tint fill + edge** are shown; halo and
 * pattern stay hidden (no gradient wash or grain overlay). The Three.js flood
 * decal is turned **off** so there is no double-draw.
 *
 * **3D (`mapMode === "3d"`)** — MapLibre stack stays **hidden**. The Three.js
 * scene is the authoritative water-surface renderer (DECALS, depthTest off;
 * see `FLOOD_RENDER_ORDER_*` in `services/three-scene.ts`).
 *
 * GeoJSON sources stay registered in both modes so `setFloodLevelFilter` can
 * apply filters even before the user switches views.
 */
export async function setActiveFloodPeriod(
  map: MLMap,
  period: string | null,
  mapMode: "2d" | "3d",
): Promise<void> {
  const entry = registry.get(map);
  if (!entry) return;
  entry.active = period;

  // Hide all currently-registered layers up-front so the user sees an
  // immediate reaction while the new period's packs are being fetched.
  for (const pack of entry.packs) {
    for (const layerId of [
      haloIdOf(pack),
      patternIdOf(pack),
      fillIdOf(pack),
      edgeIdOf(pack),
    ]) {
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

  const allFeatures: FloodPolygonFeature[] = [];
  for (const pack of matching) {
    const data = packDataCache.get(pack.path);
    if (!data) continue;
    for (const feat of data.features) {
      allFeatures.push(feat as FloodPolygonFeature);
    }
  }

  const showThreeFlood = mapMode === "3d";
  const showMapLibreFlood = mapMode === "2d";
  setFloodWireframe(map, allFeatures, showThreeFlood);

  const fillEdgeVis = showMapLibreFlood ? "visible" : "none";
  for (const pack of matching) {
    for (const layerId of [haloIdOf(pack), patternIdOf(pack)]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "none");
      }
    }
    for (const layerId of [fillIdOf(pack), edgeIdOf(pack)]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", fillEdgeVis);
      }
    }
  }

  applyFloodMapLibreVisualization(map, getFloodVisualizationSettings(map));
}

export function setFloodHazardOpacity(map: MLMap, opacity: number) {
  setFloodWireframeOpacity(map, opacity);
  applyFloodMapLibreVisualization(map, getFloodVisualizationSettings(map));
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
    for (const layerId of [
      haloIdOf(pack),
      patternIdOf(pack),
      fillIdOf(pack),
      edgeIdOf(pack),
    ]) {
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

/** Re-register hazard + PAR layers after basemap style reload. */
export async function reattachHazardLayersAfterStyleChange(
  map: MLMap,
  mapMode: "2d" | "3d",
): Promise<void> {
  ensureParLayer(map);
  const entry = registry.get(map);
  if (!entry?.packs.length) return;

  for (const pack of entry.packs) {
    const data = packDataCache.get(pack.path);
    if (data) await registerPack(map, pack, data);
  }
  await setActiveFloodPeriod(map, entry.active, mapMode);
}

/** Initialise base overlay layers + kick off MGB flood pack loading. */
export function initMapLayers(map: MLMap) {
  ensureParLayer(map);
  void ensureFloodHazardLayers(map);
}
