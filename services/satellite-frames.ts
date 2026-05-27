"use client";

import type { Map as MLMap, RasterTileSource } from "maplibre-gl";
import { recordFailure, recordSuccess } from "@/services/data-freshness";
import {
  AERIS_OVERLAY_TOP_LAYER_ID,
  BASEMAP_MARKERS_LAYER_ID,
  layerBeforeBasemapLabels,
} from "@/config/map-layers";
export type ImageryBufferSlot = 0 | 1;

/**
 * Imagery sources exposed to the UI.
 *
 * - `radar`            — RainViewer composite radar (precipitation).
 * - `himawari-airmass` — GIBS Himawari `Air_Mass` RGB composite (false-color
 *                        atmospheric analysis). Renamed from the old
 *                        `himawari-true` key so the name no longer implies
 *                        true-color imagery.
 * - `himawari-ir`      — Clean infrared (Band 13). Day/night stable, used for
 *                        cloud-top temperature and storm structure.
 */
export type LiveImagerySource = "radar" | "himawari-airmass" | "himawari-ir";

/** Legacy URL/persistence key still accepted on input and remapped to the new name. */
const LEGACY_SOURCE_ALIASES: Record<string, LiveImagerySource> = {
  "himawari-true": "himawari-airmass",
};

export function normalizeLiveImagerySource(value: string): LiveImagerySource {
  if (value === "radar" || value === "himawari-airmass" || value === "himawari-ir") {
    return value;
  }
  if (value in LEGACY_SOURCE_ALIASES) return LEGACY_SOURCE_ALIASES[value];
  return "radar";
}

/** Whether a frame represents an observed scan or a model nowcast/forecast. */
export type FrameKind = "observed" | "nowcast";

export type RadarFrame = {
  time: string;
  path: string;
  /** Defaults to `"observed"` when omitted (e.g. GIBS browse frames). */
  kind?: FrameKind;
};

export type RainViewerApiResponse = {
  host: string;
  radar: {
    past: Array<{ time: number; path: string }>;
    nowcast: Array<{ time: number; path: string }>;
  };
  satellite?: {
    infrared?: Array<{ time: number; path: string }>;
  };
};

export type RadarFramesResult = {
  frames: RadarFrame[];
};

export type LiveWeatherSourceContract = {
  source: LiveImagerySource;
  label: string;
  provider: "rainviewer" | "rainviewer-satellite" | "nasa-gibs";
  dayNightBehavior: "precipitation" | "day-night-stable" | "infrared";
  timeStepMinutes: number;
  expectedLatencyMinutes: number;
  staleAfterMinutes: number;
  maxzoom: number;
  supportsTransparency: boolean;
  attribution: string;
};

export type SatelliteFrameProvider = "rainviewer-satellite" | "gibs-fallback";
export type SatelliteFramesResult = {
  provider: SatelliteFrameProvider;
  frames: RadarFrame[];
  supportsTransparency: boolean;
  attribution: string;
};

export type GibsLayerSpec = {
  layerId: string;
  matrix: string;
  maxzoom: number;
  label: string;
};

/**
 * Himawari browse layers on GIBS `best` — each uses its own TileMatrixSet
 * (not `GoogleMapsCompatible_Level9`). Old ids (`AHI_Geocolor`, …) no longer
 * exist.
 *
 * This object is the **single source of truth** for GIBS layer metadata. The
 * `/api/gibs` route serializes this same object so the documented layer names
 * cannot drift from what the client requests at runtime.
 */
export const GIBS_WMTS: Record<Exclude<LiveImagerySource, "radar">, GibsLayerSpec> = {
  "himawari-airmass": {
    layerId: "Himawari_AHI_Air_Mass",
    matrix: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
    label: "Himawari Air Mass (false color)",
  },
  "himawari-ir": {
    layerId: "Himawari_AHI_Band13_Clean_Infrared",
    matrix: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
    label: "Himawari Clean IR (Band 13)",
  },
};

export const LIVE_WEATHER_SOURCE_CONTRACTS: Record<
  LiveImagerySource,
  LiveWeatherSourceContract
> = {
  radar: {
    source: "radar",
    label: "RainViewer Radar",
    provider: "rainviewer",
    dayNightBehavior: "precipitation",
    timeStepMinutes: 10,
    expectedLatencyMinutes: 10,
    staleAfterMinutes: 35,
    maxzoom: 7,
    supportsTransparency: true,
    attribution: "RainViewer",
  },
  "himawari-airmass": {
    source: "himawari-airmass",
    label: "Himawari Air Mass (false color)",
    /**
     * RainViewer's public satellite endpoint only ships Clean IR. To keep
     * "Air Mass" semantically honest, this preset is wired directly to GIBS
     * Himawari `Air_Mass` rather than reusing the IR feed.
     */
    provider: "nasa-gibs",
    dayNightBehavior: "day-night-stable",
    timeStepMinutes: 10,
    expectedLatencyMinutes: 35,
    staleAfterMinutes: 90,
    maxzoom: 6,
    supportsTransparency: false,
    attribution: "NASA GIBS / Himawari-9 Air Mass",
  },
  "himawari-ir": {
    source: "himawari-ir",
    label: "Himawari Clean IR (Band 13)",
    provider: "rainviewer-satellite",
    dayNightBehavior: "infrared",
    timeStepMinutes: 10,
    expectedLatencyMinutes: 20,
    staleAfterMinutes: 90,
    maxzoom: 7,
    supportsTransparency: true,
    attribution: "RainViewer Infrared (fallback: NASA GIBS Himawari-9 Band 13)",
  },
};

export function getLiveWeatherSourceContract(
  source: LiveImagerySource,
): LiveWeatherSourceContract {
  return LIVE_WEATHER_SOURCE_CONTRACTS[source];
}

const GIBS_SOURCE_ID = "src-gibs";
const GIBS_LAYER_ID = "lyr-gibs";
const GIBS_SOURCE_B_ID = "src-gibs-b";
const GIBS_LAYER_B_ID = "lyr-gibs-b";
const RADAR_SOURCE_ID = "src-radar";
const RADAR_LAYER_ID = "lyr-radar";
const RADAR_SOURCE_B_ID = "src-radar-b";
const RADAR_LAYER_B_ID = "lyr-radar-b";
const satelliteProviderByMap = new WeakMap<MLMap, SatelliteFrameProvider>();
const imageryBaseOpacityByMap = new WeakMap<MLMap, number>();

const RADAR_LAYER_IDS = [RADAR_LAYER_ID, RADAR_LAYER_B_ID] as const;
const GIBS_LAYER_IDS = [GIBS_LAYER_ID, GIBS_LAYER_B_ID] as const;

export function radarBufferIds(slot: ImageryBufferSlot): {
  source: string;
  layer: string;
} {
  return slot === 0
    ? { source: RADAR_SOURCE_ID, layer: RADAR_LAYER_ID }
    : { source: RADAR_SOURCE_B_ID, layer: RADAR_LAYER_B_ID };
}

export function gibsBufferIds(slot: ImageryBufferSlot): {
  source: string;
  layer: string;
} {
  return slot === 0
    ? { source: GIBS_SOURCE_ID, layer: GIBS_LAYER_ID }
    : { source: GIBS_SOURCE_B_ID, layer: GIBS_LAYER_B_ID };
}

export function imageryBufferSourceId(
  source: LiveImagerySource,
  slot: ImageryBufferSlot,
): string {
  return source === "radar"
    ? radarBufferIds(slot).source
    : gibsBufferIds(slot).source;
}
const TOP_CONTEXT_LAYER_IDS = [
  BASEMAP_MARKERS_LAYER_ID,
  AERIS_OVERLAY_TOP_LAYER_ID,
] as const;

/**
 * RainViewer composite tiles are only defined through this zoom; higher levels
 * return placeholder tiles ("zoom level not supported"). See RainViewer API.
 */
export const RADAR_TILE_MAX_ZOOM = 7;

/** MapLibre `maxzoom` for the current Himawari GIBS preset (VIS vs IR differ). */
export function gibsRasterMaxZoom(sourceKey: string): number {
  return resolveGibsSpec(sourceKey).maxzoom;
}

const GIBS_TIME_STEP_MS = 10 * 60 * 1000;
/**
 * GIBS "best" Himawari is not available at the wall-clock "current" 10-minute
 * slot immediately; requesting too-new times yields empty/404 tiles and the
 * map shows a broken, blocky mosaic. Keep all requests at or before this lag.
 */
const GIBS_PUBLISH_LAG_MS = 35 * 60 * 1000;

function resolveGibsSpec(sourceKey: string): GibsLayerSpec {
  const normalized = normalizeLiveImagerySource(sourceKey);
  if (normalized === "himawari-ir") return GIBS_WMTS["himawari-ir"];
  return GIBS_WMTS["himawari-airmass"];
}

export type GibsRequestDiagnostics = {
  requestedIsoTime: string;
  effectiveIsoTime: string;
  clamped: boolean;
};

function clampGibsRequestInstant(frameIsoTime: string): Date {
  const requested = new Date(frameIsoTime).getTime();
  const newestOk = Date.now() - GIBS_PUBLISH_LAG_MS;
  return new Date(Math.min(requested, newestOk));
}

export function getGibsRequestDiagnostics(frameIsoTime: string): GibsRequestDiagnostics {
  const effective = clampGibsRequestInstant(frameIsoTime);
  const requested = new Date(frameIsoTime);
  return {
    requestedIsoTime: requested.toISOString(),
    effectiveIsoTime: effective.toISOString(),
    clamped: effective.getTime() !== requested.getTime(),
  };
}

type SatelliteOverlayKind = "none" | "radar" | "gibs";

const activeOverlayByMap = new WeakMap<MLMap, SatelliteOverlayKind>();
const imageryMapModeByMap = new WeakMap<MLMap, "2d" | "3d">();
/** Last Himawari UI mode for this map — matrix/maxzoom change requires new source. */
const gibsSourceKeyByMap = new WeakMap<MLMap, string>();

function setActiveSatelliteOverlay(map: MLMap, kind: SatelliteOverlayKind) {
  activeOverlayByMap.set(map, kind);
}

function reapplySatelliteImageryForStoredMapMode(map: MLMap) {
  syncSatelliteOverlayMapMode(map, imageryMapModeByMap.get(map) ?? "2d");
}

export function floorUtcToTenMinutes(d: Date): Date {
  const t = d.getTime();
  return new Date(Math.floor(t / GIBS_TIME_STEP_MS) * GIBS_TIME_STEP_MS);
}

/** GIBS `{time}` path segment: UTC floored to 10 minutes, `YYYY-MM-DDTHH:MM:00Z`. */
export function formatGibsTimeParam(d: Date): string {
  const f = floorUtcToTenMinutes(d);
  const y = f.getUTCFullYear();
  const m = String(f.getUTCMonth() + 1).padStart(2, "0");
  const day = String(f.getUTCDate()).padStart(2, "0");
  const h = String(f.getUTCHours()).padStart(2, "0");
  const min = String(f.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}:00Z`;
}

export function buildGibsTileUrl(sourceKey: string, frameIsoTime: string): string {
  const spec = resolveGibsSpec(sourceKey);
  const diagnostics = getGibsRequestDiagnostics(frameIsoTime);
  const timeParam = formatGibsTimeParam(new Date(diagnostics.effectiveIsoTime));
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${spec.layerId}/default/${timeParam}/${spec.matrix}/{z}/{y}/{x}.png`;
}

/** Past ~110 minutes of 10-minute UTC steps for Himawari browse animation. */
export function gibsAnimationFrames(stepsBack = 11): RadarFrame[] {
  const anchor = floorUtcToTenMinutes(
    new Date(Date.now() - GIBS_PUBLISH_LAG_MS),
  );
  const out: RadarFrame[] = [];
  for (let i = stepsBack; i >= 0; i--) {
    out.push({
      time: new Date(anchor.getTime() - i * GIBS_TIME_STEP_MS).toISOString(),
      path: "",
      kind: "observed",
    });
  }
  return out;
}

/**
 * RainViewer sometimes returns a short hash path (`/v2/radar/<id>`) and
 * sometimes a full XYZ template. MapLibre needs a single template URL.
 */
export function buildRadarTileUrl(fullTileTemplateOrBase: string): string {
  const base = fullTileTemplateOrBase.trim().replace(/\/$/, "");
  if (!base) return "";
  if (/\{z\}/.test(base) && /\{x\}/.test(base) && /\{y\}/.test(base)) {
    return base;
  }
  return `${base}/256/{z}/{x}/{y}/2/1_1.png`;
}

function satelliteTileUrl(
  sourceKey: Exclude<LiveImagerySource, "radar">,
  provider: SatelliteFrameProvider,
  frame: RadarFrame,
): string {
  if (provider === "rainviewer-satellite") {
    return buildRadarTileUrl(frame.path);
  }
  return buildGibsTileUrl(sourceKey, frame.time);
}

/** Keep GIBS / RainViewer rasters above lazily inserted hazard vectors. */
export function pinSatelliteRastersToTop(map: MLMap) {
  if (typeof map.moveLayer !== "function") return;
  const labelAnchor = layerBeforeBasemapLabels(map);
  for (const layerId of [...GIBS_LAYER_IDS, ...RADAR_LAYER_IDS]) {
    if (!map.getLayer(layerId)) continue;
    if (labelAnchor) map.moveLayer(layerId, labelAnchor);
    else map.moveLayer(layerId);
  }
  for (const layerId of TOP_CONTEXT_LAYER_IDS) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

/**
 * Satellite and radar overlays are authored for a flat map; hide them in 3D
 * where terrain + the Three.js scene own the viewport.
 */
function syncSatelliteOverlayMapMode(map: MLMap, mode: "2d" | "3d") {
  const kind = activeOverlayByMap.get(map) ?? "none";
  if (mode === "3d") {
    for (const layerId of [...RADAR_LAYER_IDS, ...GIBS_LAYER_IDS]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "none");
      }
    }
    return;
  }

  const vis = "visible" as const;
  const hidden = "none" as const;
  if (kind === "radar") {
    for (const layerId of RADAR_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", vis);
    }
    for (const layerId of GIBS_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", hidden);
    }
  } else if (kind === "gibs") {
    for (const layerId of GIBS_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", vis);
    }
    for (const layerId of RADAR_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", hidden);
    }
  }
  pinSatelliteRastersToTop(map);
}

/** Call from `applyMapViewMode` whenever the user toggles 2D / 3D. */
export function notifyMapViewModeForSatelliteImagery(
  map: MLMap,
  mode: "2d" | "3d",
) {
  imageryMapModeByMap.set(map, mode);
  syncSatelliteOverlayMapMode(map, mode);
}

export async function fetchRadarFrames(): Promise<RadarFramesResult> {
  try {
    const res = await fetch("/api/rainviewer", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as
      | RainViewerApiResponse
      | { error?: string };
    if (!res.ok) {
      const message =
        "error" in data && typeof data.error === "string"
          ? data.error
          : `RainViewer ${res.status}`;
      recordFailure("radar", message);
      throw new Error(message);
    }
    if (!isRainViewerApiResponse(data)) {
      recordFailure("radar", "RainViewer returned an invalid payload.");
      throw new Error("RainViewer returned an invalid payload.");
    }
    const observed: RadarFrame[] = data.radar.past.map((f) => ({
      time: new Date(f.time * 1000).toISOString(),
      path: `${data.host}${f.path}`,
      kind: "observed",
    }));
    const nowcast: RadarFrame[] = data.radar.nowcast.map((f) => ({
      time: new Date(f.time * 1000).toISOString(),
      path: `${data.host}${f.path}`,
      kind: "nowcast",
    }));
    recordSuccess("radar");
    return { frames: [...observed, ...nowcast] };
  } catch (error) {
    recordFailure("radar", (error as Error).message);
    throw error;
  }
}

export async function fetchSatelliteFrames(
  sourceKey: Exclude<LiveImagerySource, "radar">,
): Promise<SatelliteFramesResult> {
  const freshnessKey = `satellite:${sourceKey}`;
  /**
   * Air Mass is a GIBS-only product (RainViewer doesn't expose it). Route the
   * preset directly to GIBS so the imagery actually matches the label, and
   * skip the RainViewer round-trip entirely.
   */
  if (sourceKey === "himawari-airmass") {
    recordSuccess(freshnessKey);
    return {
      provider: "gibs-fallback",
      frames: gibsAnimationFrames(),
      supportsTransparency: false,
      attribution: "NASA GIBS / Himawari-9 Air Mass",
    };
  }

  try {
    const res = await fetch("/api/rainviewer", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as
      | RainViewerApiResponse
      | { error?: string };
    if (!res.ok || !isRainViewerApiResponse(data)) {
      const message = !res.ok
        ? "error" in data && typeof data.error === "string"
          ? data.error
          : `RainViewer ${res.status}`
        : "RainViewer returned an invalid payload.";
      throw new Error(message);
    }
    const sat = data.satellite?.infrared ?? [];
    if (sat.length > 0) {
      recordSuccess(freshnessKey);
      return {
        provider: "rainviewer-satellite",
        frames: sat.map((f) => ({
          time: new Date(f.time * 1000).toISOString(),
          path: `${data.host}${f.path}`,
          kind: "observed",
        })),
        supportsTransparency: true,
        attribution: "RainViewer Infrared",
      };
    }
    recordFailure(
      freshnessKey,
      "RainViewer satellite catalog is empty; using GIBS fallback.",
    );
  } catch (error) {
    recordFailure(freshnessKey, (error as Error).message);
  }
  return {
    provider: "gibs-fallback",
    frames: gibsAnimationFrames(),
    supportsTransparency: false,
    attribution: "NASA GIBS / Himawari-9",
  };
}

function removeGibsLayersIfAny(map: MLMap) {
  for (const layerId of GIBS_LAYER_IDS) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const sourceId of [GIBS_SOURCE_ID, GIBS_SOURCE_B_ID]) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

function removeRadarLayersIfAny(map: MLMap) {
  for (const layerId of RADAR_LAYER_IDS) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  for (const sourceId of [RADAR_SOURCE_ID, RADAR_SOURCE_B_ID]) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}

function baseOpacityFromPaint(paint: RasterPaintSpec): number {
  const raw = paint["raster-opacity"];
  return typeof raw === "number" ? raw : 1;
}

/**
 * Apply a warm amber tint to a buffer layer when it is showing a `nowcast`
 * (forecast) frame. Mirrors the orange "Forecast" badge in the HUD so the
 * observed -> nowcast transition is visible in the imagery itself.
 *
 * Pass `applied = false` to restore the layer's baseline paint.
 */
export function setImageryBufferNowcastTint(
  map: MLMap,
  source: LiveImagerySource,
  slot: ImageryBufferSlot,
  applied: boolean,
) {
  const layerId =
    source === "radar"
      ? radarBufferIds(slot).layer
      : gibsBufferIds(slot).layer;
  if (!map.getLayer(layerId)) return;
  if (applied) {
    map.setPaintProperty(layerId, "raster-hue-rotate", 18);
    map.setPaintProperty(layerId, "raster-saturation", 0.25);
    map.setPaintProperty(layerId, "raster-brightness-min", 0.08);
    return;
  }
  // Restore baseline paint values for the source.
  if (source === "radar") {
    map.setPaintProperty(layerId, "raster-hue-rotate", 0);
    map.setPaintProperty(layerId, "raster-saturation", 0.15);
    map.setPaintProperty(layerId, "raster-brightness-min", 0.2);
    return;
  }
  // For satellite presets, leave hue-rotate at 0 and let the active paint
  // (gibs vs rainviewer-satellite) reapply its own contrast/saturation on the
  // next frame swap; resetting the three shifted properties is enough to drop
  // the amber cast.
  map.setPaintProperty(layerId, "raster-hue-rotate", 0);
  if (source === "himawari-ir") {
    map.setPaintProperty(layerId, "raster-saturation", -0.1);
    map.setPaintProperty(layerId, "raster-brightness-min", 0.08);
  } else {
    map.setPaintProperty(layerId, "raster-saturation", 0.22);
    map.setPaintProperty(layerId, "raster-brightness-min", 0.01);
  }
}

export function setImageryBufferOpacity(
  map: MLMap,
  source: LiveImagerySource,
  slot: ImageryBufferSlot,
  multiplier: number,
) {
  const layerId =
    source === "radar"
      ? radarBufferIds(slot).layer
      : gibsBufferIds(slot).layer;
  if (!map.getLayer(layerId)) return;
  const base = imageryBaseOpacityByMap.get(map) ?? 1;
  map.setPaintProperty(layerId, "raster-opacity", base * Math.max(0, Math.min(1, multiplier)));
}

export function resetImageryBufferOpacities(
  map: MLMap,
  source: LiveImagerySource,
  activeSlot: ImageryBufferSlot,
) {
  setImageryBufferOpacity(map, source, activeSlot, 1);
  const inactiveSlot: ImageryBufferSlot = activeSlot === 0 ? 1 : 0;
  setImageryBufferOpacity(map, source, inactiveSlot, 0);
}

/** Incoming frame layer should sit above the outgoing buffer during crossfade. */
export function raiseImageryBufferSlot(
  map: MLMap,
  source: LiveImagerySource,
  slot: ImageryBufferSlot,
) {
  const layerId =
    source === "radar"
      ? radarBufferIds(slot).layer
      : gibsBufferIds(slot).layer;
  if (!map.getLayer(layerId) || typeof map.moveLayer !== "function") return;
  const labelAnchor = layerBeforeBasemapLabels(map);
  if (labelAnchor) map.moveLayer(layerId, labelAnchor);
  else map.moveLayer(layerId);
  pinSatelliteRastersToTop(map);
}

type SatelliteBlendPreset = "disturbance-only" | "screen-like";
type RasterPaintSpec = Record<string, string | number>;

/**
 * Himawari tiles are full-frame imagery (non-transparent backgrounds), unlike
 * RainViewer radar composites that naturally carry transparency. To behave like
 * an overlay on the PH basemap, we intentionally keep Himawari semi-transparent
 * and apply gentle tonal shaping.
 */
function gibsRasterPaint(sourceKey: string): RasterPaintSpec {
  const preset: SatelliteBlendPreset =
    sourceKey === "himawari-ir" ? "disturbance-only" : "screen-like";

  if (preset === "disturbance-only") {
    return {
      "raster-opacity": 0.5,
      "raster-fade-duration": 0,
      "raster-resampling": "linear",
      "raster-contrast": 0.4,
      "raster-saturation": -0.4,
      "raster-brightness-min": 0.02,
      "raster-brightness-max": 0.96,
      "raster-hue-rotate": 0,
    };
  }

  if (sourceKey === "himawari-airmass" || sourceKey === "himawari-true") {
    return {
      "raster-opacity": 0.54,
      "raster-fade-duration": 0,
      "raster-resampling": "linear",
      "raster-contrast": 0.36,
      "raster-saturation": 0.22,
      "raster-brightness-min": 0.01,
      "raster-brightness-max": 0.98,
      "raster-hue-rotate": 0,
    };
  }
  return {
    "raster-opacity": 0.5,
    "raster-fade-duration": 0,
    "raster-resampling": "linear",
    "raster-contrast": 0.34,
    "raster-saturation": 0.06,
    "raster-brightness-min": 0.02,
    "raster-brightness-max": 0.96,
    "raster-hue-rotate": 0,
  };
}

function transparentSatelliteOverlayPaint(
  sourceKey: Exclude<LiveImagerySource, "radar">,
): RasterPaintSpec {
  if (sourceKey === "himawari-ir") {
    return {
      "raster-opacity": 1,
      "raster-fade-duration": 0,
      "raster-resampling": "linear",
      "raster-contrast": 0.2,
      "raster-saturation": -0.1,
      "raster-brightness-min": 0.08,
      "raster-brightness-max": 1,
    };
  }
  return {
    "raster-opacity": 1,
    "raster-fade-duration": 0,
    "raster-resampling": "linear",
    "raster-contrast": 0.16,
    "raster-saturation": 0.08,
    "raster-brightness-min": 0.08,
    "raster-brightness-max": 1,
  };
}

function applyRasterPaint(
  map: MLMap,
  layerId: string,
  paint: RasterPaintSpec,
) {
  if (!map.getLayer(layerId)) return;
  for (const [key, value] of Object.entries(paint)) {
    map.setPaintProperty(layerId, key, value);
  }
}

function addGibsBufferLayer(
  map: MLMap,
  slot: ImageryBufferSlot,
  tileUrl: string,
  maxzoom: number,
  attribution: string,
  paint: RasterPaintSpec,
) {
  const { source: sourceId, layer: layerId } = gibsBufferIds(slot);
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom,
      attribution,
    });
  } else {
    const src = map.getSource(sourceId) as RasterTileSource | undefined;
    if (src && "setTiles" in src && tileUrl) {
      src.setTiles([tileUrl]);
    }
  }
  if (!map.getLayer(layerId)) {
    map.addLayer(
      {
        id: layerId,
        type: "raster",
        source: sourceId,
        paint,
      },
      layerBeforeBasemapLabels(map),
    );
  } else {
    applyRasterPaint(map, layerId, paint);
  }
}

export function setSatelliteFrameOnSlot(
  map: MLMap,
  slot: ImageryBufferSlot,
  sourceKey: Exclude<LiveImagerySource, "radar">,
  frame: RadarFrame,
  provider: SatelliteFrameProvider,
) {
  const spec = resolveGibsSpec(sourceKey);
  const tileUrl = satelliteTileUrl(sourceKey, provider, frame);
  const paint =
    provider === "rainviewer-satellite"
      ? transparentSatelliteOverlayPaint(sourceKey)
      : gibsRasterPaint(sourceKey);
  const maxzoom = provider === "rainviewer-satellite" ? RADAR_TILE_MAX_ZOOM : spec.maxzoom;
  const attribution =
    provider === "rainviewer-satellite" ? "RainViewer Satellite" : "NASA GIBS / Himawari-9";
  imageryBaseOpacityByMap.set(map, baseOpacityFromPaint(paint));
  addGibsBufferLayer(map, slot, tileUrl, maxzoom, attribution, paint);
}

export function ensureSatelliteLayer(
  map: MLMap,
  sourceKey: Exclude<LiveImagerySource, "radar">,
  frame: RadarFrame,
  provider: SatelliteFrameProvider,
) {
  setActiveSatelliteOverlay(map, "gibs");
  for (const layerId of RADAR_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", "none");
    }
  }

  const spec = resolveGibsSpec(sourceKey);
  const prevKey = gibsSourceKeyByMap.get(map);
  const prevNormalized = prevKey
    ? (normalizeLiveImagerySource(prevKey) as LiveImagerySource)
    : null;
  const prevProvider = satelliteProviderByMap.get(map);
  const prevSpec =
    prevNormalized && prevNormalized !== "radar"
      ? GIBS_WMTS[prevNormalized as Exclude<LiveImagerySource, "radar">]
      : null;
  const sourceShapeChanged =
    provider !== prevProvider ||
    (provider === "gibs-fallback" &&
      !!prevSpec &&
      (prevSpec.matrix !== spec.matrix || prevSpec.maxzoom !== spec.maxzoom));

  if (sourceShapeChanged) {
    removeGibsLayersIfAny(map);
  }

  setSatelliteFrameOnSlot(map, 0, sourceKey, frame, provider);
  for (const slot of [1] as const) {
    setSatelliteFrameOnSlot(
      map,
      slot,
      sourceKey,
      frame,
      provider,
    );
    setImageryBufferOpacity(map, sourceKey, slot, 0);
  }
  setImageryBufferOpacity(map, sourceKey, 0, 1);

  for (const layerId of GIBS_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", "visible");
    }
  }
  gibsSourceKeyByMap.set(map, sourceKey);
  satelliteProviderByMap.set(map, provider);
  pinSatelliteRastersToTop(map);
  reapplySatelliteImageryForStoredMapMode(map);
}

export function ensureGibsLayer(map: MLMap, sourceKey: string) {
  ensureSatelliteLayer(
    map,
    sourceKey as Exclude<LiveImagerySource, "radar">,
    { time: new Date().toISOString(), path: "" },
    "gibs-fallback",
  );
}

/**
 * Returns the raster paint spec for a given imagery source. Exposed for
 * regression tests that guard `raster-fade-duration: 0` (the JS ticker owns
 * crossfades — MapLibre's native tile fade must stay disabled to avoid the
 * end-of-loop disappearance bug).
 */
export function getImageryRasterPaint(source: LiveImagerySource): RasterPaintSpec {
  if (source === "radar") return radarLayerPaint();
  if (source === "himawari-ir") {
    // Two paint variants depending on provider; both must keep fade-duration: 0.
    return transparentSatelliteOverlayPaint("himawari-ir");
  }
  return gibsRasterPaint("himawari-airmass");
}

export function getAllImageryRasterPaints(): RasterPaintSpec[] {
  return [
    radarLayerPaint(),
    gibsRasterPaint("himawari-ir"),
    gibsRasterPaint("himawari-airmass"),
    transparentSatelliteOverlayPaint("himawari-ir"),
    transparentSatelliteOverlayPaint("himawari-airmass"),
  ];
}

function radarLayerPaint(): RasterPaintSpec {
  return {
    "raster-opacity": 1,
    "raster-fade-duration": 0,
    "raster-contrast": 0.3,
    "raster-saturation": 0.15,
    "raster-brightness-min": 0.2,
    "raster-brightness-max": 1,
  };
}

function addRadarBufferLayer(
  map: MLMap,
  slot: ImageryBufferSlot,
  url: string | null,
) {
  if (!url) return;
  const { source: sourceId, layer: layerId } = radarBufferIds(slot);
  const paint = radarLayerPaint();
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "raster",
      tiles: [url],
      tileSize: 256,
      maxzoom: RADAR_TILE_MAX_ZOOM,
      attribution: "RainViewer",
    });
  } else {
    const src = map.getSource(sourceId) as RasterTileSource | undefined;
    if (src && "setTiles" in src) {
      src.setTiles([url]);
    }
  }
  if (!map.getLayer(layerId)) {
    map.addLayer(
      {
        id: layerId,
        type: "raster",
        source: sourceId,
        paint,
      },
      layerBeforeBasemapLabels(map),
    );
  } else {
    applyRasterPaint(map, layerId, paint);
  }
}

export function setRadarFrameOnSlot(
  map: MLMap,
  slot: ImageryBufferSlot,
  frame: RadarFrame,
) {
  const url = radarTileUrl(frame);
  if (!url) return;
  imageryBaseOpacityByMap.set(map, 1);
  addRadarBufferLayer(map, slot, url);
}

export function ensureRadarLayer(map: MLMap, frame?: RadarFrame) {
  for (const layerId of GIBS_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", "none");
    }
  }
  if (!frame) return;
  const url = radarTileUrl(frame);
  if (!url) return;
  setActiveSatelliteOverlay(map, "radar");
  setRadarFrameOnSlot(map, 0, frame);
  setRadarFrameOnSlot(map, 1, frame);
  resetImageryBufferOpacities(map, "radar", 0);
  for (const layerId of RADAR_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", "visible");
    }
  }
  pinSatelliteRastersToTop(map);
  reapplySatelliteImageryForStoredMapMode(map);
}

/** Set the active buffer slot to a frame (used for style reattach and first paint). */
export function setFrameTimestamp(
  map: MLMap,
  source: LiveImagerySource,
  frame: RadarFrame,
  provider: SatelliteFrameProvider = "gibs-fallback",
  activeSlot: ImageryBufferSlot = 0,
) {
  if (source === "radar") {
    if (map.getSource(RADAR_SOURCE_ID)) {
      setRadarFrameOnSlot(map, activeSlot, frame);
      pinSatelliteRastersToTop(map);
      reapplySatelliteImageryForStoredMapMode(map);
    } else {
      ensureRadarLayer(map, frame);
    }
  } else {
    const sourceKey = source as Exclude<LiveImagerySource, "radar">;
    if (map.getSource(GIBS_SOURCE_ID)) {
      setSatelliteFrameOnSlot(map, activeSlot, sourceKey, frame, provider);
      satelliteProviderByMap.set(map, provider);
      gibsSourceKeyByMap.set(map, sourceKey);
      pinSatelliteRastersToTop(map);
      reapplySatelliteImageryForStoredMapMode(map);
    } else {
      ensureSatelliteLayer(map, sourceKey, frame, provider);
    }
  }
}

function radarTileUrl(frame: RadarFrame) {
  if (!frame.path) return "";
  return buildRadarTileUrl(frame.path);
}

function isRainViewerApiResponse(value: unknown): value is RainViewerApiResponse {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<RainViewerApiResponse>;
  return (
    typeof payload.host === "string" &&
    typeof payload.radar === "object" &&
    payload.radar !== null &&
    Array.isArray(payload.radar.past) &&
    Array.isArray(payload.radar.nowcast)
  );
}
