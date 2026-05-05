"use client";

import type { Map as MLMap, RasterTileSource } from "maplibre-gl";
import { recordFailure, recordSuccess } from "@/services/data-freshness";

export type LiveImagerySource = "radar" | "himawari-true" | "himawari-ir";

export type RadarFrame = {
  time: string;
  path: string;
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

type GibsLayerSpec = {
  layerId: string;
  matrix: string;
  maxzoom: number;
};

/**
 * Himawari browse layers on GIBS `best` — each uses its own TileMatrixSet
 * (not `GoogleMapsCompatible_Level9`). Old ids (`AHI_Geocolor`, …) no longer exist.
 */
const GIBS_WMTS: Record<Exclude<LiveImagerySource, "radar">, GibsLayerSpec> = {
  "himawari-true": {
    /**
     * Use Air_Mass for the "visual" preset so the feed remains informative
     * across day/night cycles. Single visible-band products go near-black at
     * night and look broken in ops dashboards.
     */
    layerId: "Himawari_AHI_Air_Mass",
    matrix: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
  },
  "himawari-ir": {
    layerId: "Himawari_AHI_Band13_Clean_Infrared",
    matrix: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
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
  "himawari-true": {
    source: "himawari-true",
    label: "RainViewer Satellite (Enhanced IR)",
    provider: "rainviewer-satellite",
    dayNightBehavior: "day-night-stable",
    timeStepMinutes: 10,
    expectedLatencyMinutes: 20,
    staleAfterMinutes: 90,
    maxzoom: 7,
    supportsTransparency: true,
    attribution: "RainViewer Satellite (fallback: NASA GIBS Himawari-9)",
  },
  "himawari-ir": {
    source: "himawari-ir",
    label: "RainViewer Satellite (IR)",
    provider: "rainviewer-satellite",
    dayNightBehavior: "infrared",
    timeStepMinutes: 10,
    expectedLatencyMinutes: 20,
    staleAfterMinutes: 90,
    maxzoom: 7,
    supportsTransparency: true,
    attribution: "RainViewer Satellite (fallback: NASA GIBS Himawari-9)",
  },
};

export function getLiveWeatherSourceContract(
  source: LiveImagerySource,
): LiveWeatherSourceContract {
  return LIVE_WEATHER_SOURCE_CONTRACTS[source];
}

const GIBS_SOURCE_ID = "src-gibs";
const GIBS_LAYER_ID = "lyr-gibs";
const RADAR_SOURCE_ID = "src-radar";
const RADAR_LAYER_ID = "lyr-radar";
const satelliteProviderByMap = new WeakMap<MLMap, SatelliteFrameProvider>();
const TOP_CONTEXT_LAYER_IDS = [
  "osm-top-labels",
  "ph-major-city-dots",
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
  if (sourceKey === "himawari-ir") return GIBS_WMTS["himawari-ir"];
  return GIBS_WMTS["himawari-true"];
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
  if (map.getLayer(GIBS_LAYER_ID)) {
    map.moveLayer(GIBS_LAYER_ID);
  }
  if (map.getLayer(RADAR_LAYER_ID)) {
    map.moveLayer(RADAR_LAYER_ID);
  }
  // Keep contextual orientation aids above weather overlays.
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
    if (map.getLayer(RADAR_LAYER_ID)) {
      map.setLayoutProperty(RADAR_LAYER_ID, "visibility", "none");
    }
    if (map.getLayer(GIBS_LAYER_ID)) {
      map.setLayoutProperty(GIBS_LAYER_ID, "visibility", "none");
    }
    return;
  }

  const vis = "visible" as const;
  const hidden = "none" as const;
  if (kind === "radar") {
    if (map.getLayer(RADAR_LAYER_ID)) map.setLayoutProperty(RADAR_LAYER_ID, "visibility", vis);
    if (map.getLayer(GIBS_LAYER_ID)) map.setLayoutProperty(GIBS_LAYER_ID, "visibility", hidden);
  } else if (kind === "gibs") {
    if (map.getLayer(GIBS_LAYER_ID)) map.setLayoutProperty(GIBS_LAYER_ID, "visibility", vis);
    if (map.getLayer(RADAR_LAYER_ID)) map.setLayoutProperty(RADAR_LAYER_ID, "visibility", hidden);
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
    const all = [...data.radar.past, ...data.radar.nowcast];
    const frames = all.map((f) => ({
      time: new Date(f.time * 1000).toISOString(),
      path: `${data.host}${f.path}`,
    }));
    recordSuccess("radar");
    return { frames };
  } catch (error) {
    recordFailure("radar", (error as Error).message);
    throw error;
  }
}

export async function fetchSatelliteFrames(
  sourceKey: Exclude<LiveImagerySource, "radar">,
): Promise<SatelliteFramesResult> {
  try {
    const res = await fetch("/api/rainviewer", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as
      | RainViewerApiResponse
      | { error?: string };
    if (!res.ok || !isRainViewerApiResponse(data)) {
      throw new Error(
        !res.ok
          ? "error" in data && typeof data.error === "string"
            ? data.error
            : `RainViewer ${res.status}`
          : "RainViewer returned an invalid payload.",
      );
    }
    const sat = data.satellite?.infrared ?? [];
    if (sat.length > 0) {
      return {
        provider: "rainviewer-satellite",
        frames: sat.map((f) => ({
          time: new Date(f.time * 1000).toISOString(),
          path: `${data.host}${f.path}`,
        })),
        supportsTransparency: true,
        attribution: "RainViewer Satellite",
      };
    }
  } catch {
    // Fall through to GIBS fallback.
  }
  return {
    provider: "gibs-fallback",
    frames: gibsAnimationFrames(),
    supportsTransparency: false,
    attribution: "NASA GIBS / Himawari-9",
  };
}

function removeGibsLayerIfAny(map: MLMap) {
  if (map.getLayer(GIBS_LAYER_ID)) map.removeLayer(GIBS_LAYER_ID);
  if (map.getSource(GIBS_SOURCE_ID)) map.removeSource(GIBS_SOURCE_ID);
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

  if (sourceKey === "himawari-true") {
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

export function ensureSatelliteLayer(
  map: MLMap,
  sourceKey: Exclude<LiveImagerySource, "radar">,
  frame: RadarFrame,
  provider: SatelliteFrameProvider,
) {
  setActiveSatelliteOverlay(map, "gibs");
  if (map.getLayer(RADAR_LAYER_ID)) {
    map.setLayoutProperty(RADAR_LAYER_ID, "visibility", "none");
  }

  const spec = resolveGibsSpec(sourceKey);
  const prevKey = gibsSourceKeyByMap.get(map);
  const prevProvider = satelliteProviderByMap.get(map);
  const prevSpec =
    prevKey && prevKey in GIBS_WMTS
      ? GIBS_WMTS[prevKey as Exclude<LiveImagerySource, "radar">]
      : null;
  const tileUrl = satelliteTileUrl(sourceKey, provider, frame);
  const sourceShapeChanged =
    provider !== prevProvider ||
    (provider === "gibs-fallback" &&
      !!prevSpec &&
      (prevSpec.matrix !== spec.matrix || prevSpec.maxzoom !== spec.maxzoom));
  const paint =
    provider === "rainviewer-satellite"
      ? transparentSatelliteOverlayPaint(sourceKey)
      : gibsRasterPaint(sourceKey);
  const maxzoom = provider === "rainviewer-satellite" ? RADAR_TILE_MAX_ZOOM : spec.maxzoom;
  const attribution =
    provider === "rainviewer-satellite" ? "RainViewer Satellite" : "NASA GIBS / Himawari-9";

  if (!map.getSource(GIBS_SOURCE_ID) || sourceShapeChanged) {
    removeGibsLayerIfAny(map);
    map.addSource(GIBS_SOURCE_ID, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom,
      attribution,
    });
    map.addLayer({
      id: GIBS_LAYER_ID,
      type: "raster",
      source: GIBS_SOURCE_ID,
      paint,
    });
  } else {
    const src = map.getSource(GIBS_SOURCE_ID) as RasterTileSource | undefined;
    if (src && "setTiles" in src) {
      src.setTiles([tileUrl]);
    }
    if (!map.getLayer(GIBS_LAYER_ID)) {
      map.addLayer({
        id: GIBS_LAYER_ID,
        type: "raster",
        source: GIBS_SOURCE_ID,
        paint,
      });
    } else {
      map.setLayoutProperty(GIBS_LAYER_ID, "visibility", "visible");
      applyRasterPaint(map, GIBS_LAYER_ID, paint);
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

export function ensureRadarLayer(map: MLMap, frame?: RadarFrame) {
  if (map.getLayer(GIBS_LAYER_ID)) {
    map.setLayoutProperty(GIBS_LAYER_ID, "visibility", "none");
  }
  const url = frame ? radarTileUrl(frame) : null;
  if (!map.getSource(RADAR_SOURCE_ID)) {
    if (!url) return;
    setActiveSatelliteOverlay(map, "radar");
    map.addSource(RADAR_SOURCE_ID, {
      type: "raster",
      tiles: [url],
      tileSize: 256,
      maxzoom: RADAR_TILE_MAX_ZOOM,
      attribution: "RainViewer",
    });
    map.addLayer({
      id: RADAR_LAYER_ID,
      type: "raster",
      source: RADAR_SOURCE_ID,
      paint: {
        // Restore fully opaque disturbance pixels while keeping low-return clutter subdued.
        "raster-opacity": 1,
        "raster-fade-duration": 220,
        "raster-contrast": 0.3,
        "raster-saturation": 0.15,
        "raster-brightness-min": 0.2,
        "raster-brightness-max": 1,
      },
    });
  } else {
    setActiveSatelliteOverlay(map, "radar");
    map.setLayoutProperty(RADAR_LAYER_ID, "visibility", "visible");
    const src = map.getSource(RADAR_SOURCE_ID) as RasterTileSource | undefined;
    if (src && "setTiles" in src && url) {
      src.setTiles([url]);
    }
  }
  pinSatelliteRastersToTop(map);
  reapplySatelliteImageryForStoredMapMode(map);
}

export function setFrameTimestamp(
  map: MLMap,
  source: LiveImagerySource,
  frame: RadarFrame,
  provider: SatelliteFrameProvider = "gibs-fallback",
) {
  if (source === "radar") {
    const url = radarTileUrl(frame);
    const src = map.getSource(RADAR_SOURCE_ID) as RasterTileSource | undefined;
    if (src && "setTiles" in src) {
      src.setTiles([url]);
      pinSatelliteRastersToTop(map);
      reapplySatelliteImageryForStoredMapMode(map);
    } else if (url) {
      ensureRadarLayer(map, frame);
    }
  } else {
    const sourceKey = source as Exclude<LiveImagerySource, "radar">;
    const tileUrl = satelliteTileUrl(sourceKey, provider, frame);
    const src = map.getSource(GIBS_SOURCE_ID) as RasterTileSource | undefined;
    if (src && "setTiles" in src) {
      src.setTiles([tileUrl]);
      applyRasterPaint(
        map,
        GIBS_LAYER_ID,
        provider === "rainviewer-satellite"
          ? transparentSatelliteOverlayPaint(sourceKey)
          : gibsRasterPaint(sourceKey),
      );
      satelliteProviderByMap.set(map, provider);
      gibsSourceKeyByMap.set(map, sourceKey);
    } else if (tileUrl) {
      ensureSatelliteLayer(map, sourceKey, frame, provider);
    }
    pinSatelliteRastersToTop(map);
    reapplySatelliteImageryForStoredMapMode(map);
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
