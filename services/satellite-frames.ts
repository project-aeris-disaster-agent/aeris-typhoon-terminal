"use client";

import type { Map as MLMap, RasterTileSource } from "maplibre-gl";
import { recordFailure, recordSuccess } from "@/services/data-freshness";

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
};

export type RadarFramesResult = {
  frames: RadarFrame[];
};

/**
 * Himawari browse layers on GIBS `best` — each uses its own TileMatrixSet
 * (not `GoogleMapsCompatible_Level9`). Old ids (`AHI_Geocolor`, …) no longer exist.
 */
const GIBS_WMTS: Record<
  string,
  { layerId: string; matrix: string; maxzoom: number }
> = {
  "himawari-true": {
    layerId: "Himawari_AHI_Band3_Red_Visible_1km",
    matrix: "GoogleMapsCompatible_Level7",
    /** Native tile z tops out at 6 (z=7 is 404); must match MapLibre source maxzoom. */
    maxzoom: 6,
  },
  "himawari-ir": {
    layerId: "Himawari_AHI_Band13_Clean_Infrared",
    matrix: "GoogleMapsCompatible_Level6",
    maxzoom: 6,
  },
};

const GIBS_SOURCE_ID = "src-gibs";
const GIBS_LAYER_ID = "lyr-gibs";
const RADAR_SOURCE_ID = "src-radar";
const RADAR_LAYER_ID = "lyr-radar";

/**
 * RainViewer composite tiles are only defined through this zoom; higher levels
 * return placeholder tiles ("zoom level not supported"). See RainViewer API.
 */
export const RADAR_TILE_MAX_ZOOM = 7;

/** MapLibre `maxzoom` for the current Himawari GIBS preset (VIS vs IR differ). */
export function gibsRasterMaxZoom(sourceKey: string): number {
  return GIBS_WMTS[sourceKey]?.maxzoom ?? GIBS_WMTS["himawari-ir"].maxzoom;
}

const GIBS_TIME_STEP_MS = 10 * 60 * 1000;
/**
 * GIBS "best" Himawari is not available at the wall-clock "current" 10-minute
 * slot immediately; requesting too-new times yields empty/404 tiles and the
 * map shows a broken, blocky mosaic. Keep all requests at or before this lag.
 */
const GIBS_PUBLISH_LAG_MS = 35 * 60 * 1000;

function clampGibsRequestInstant(frameIsoTime: string): Date {
  const requested = new Date(frameIsoTime).getTime();
  const newestOk = Date.now() - GIBS_PUBLISH_LAG_MS;
  return new Date(Math.min(requested, newestOk));
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
  const spec = GIBS_WMTS[sourceKey] ?? GIBS_WMTS["himawari-true"];
  const timeParam = formatGibsTimeParam(clampGibsRequestInstant(frameIsoTime));
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

/** Keep GIBS / RainViewer rasters above lazily inserted hazard vectors. */
export function pinSatelliteRastersToTop(map: MLMap) {
  if (typeof map.moveLayer !== "function") return;
  if (map.getLayer(GIBS_LAYER_ID)) {
    map.moveLayer(GIBS_LAYER_ID);
  }
  if (map.getLayer(RADAR_LAYER_ID)) {
    map.moveLayer(RADAR_LAYER_ID);
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

function removeGibsLayerIfAny(map: MLMap) {
  if (map.getLayer(GIBS_LAYER_ID)) map.removeLayer(GIBS_LAYER_ID);
  if (map.getSource(GIBS_SOURCE_ID)) map.removeSource(GIBS_SOURCE_ID);
}

/** Band 3 is single-channel; lift slightly on the dark basemap. IR stays neutral. */
function gibsRasterPaint(sourceKey: string): Record<string, string | number> {
  if (sourceKey === "himawari-true") {
    return {
      "raster-opacity": 0.9,
      "raster-fade-duration": 0,
      "raster-contrast": 0.22,
      "raster-resampling": "linear",
    };
  }
  return {
    "raster-opacity": 0.82,
    "raster-fade-duration": 0,
    "raster-resampling": "linear",
  };
}

export function ensureGibsLayer(map: MLMap, sourceKey: string) {
  setActiveSatelliteOverlay(map, "gibs");
  if (map.getLayer(RADAR_LAYER_ID)) {
    map.setLayoutProperty(RADAR_LAYER_ID, "visibility", "none");
  }

  const spec = GIBS_WMTS[sourceKey] ?? GIBS_WMTS["himawari-true"];
  const prevKey = gibsSourceKeyByMap.get(map);
  const tileUrl = buildGibsTileUrl(sourceKey, new Date().toISOString());
  const matrixChanged = prevKey !== undefined && prevKey !== sourceKey;

  if (!map.getSource(GIBS_SOURCE_ID) || matrixChanged) {
    removeGibsLayerIfAny(map);
    map.addSource(GIBS_SOURCE_ID, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom: spec.maxzoom,
      attribution: "NASA GIBS / Himawari-9",
    });
    map.addLayer({
      id: GIBS_LAYER_ID,
      type: "raster",
      source: GIBS_SOURCE_ID,
      paint: gibsRasterPaint(sourceKey),
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
        paint: gibsRasterPaint(sourceKey),
      });
    } else {
      map.setLayoutProperty(GIBS_LAYER_ID, "visibility", "visible");
    }
  }
  gibsSourceKeyByMap.set(map, sourceKey);
  pinSatelliteRastersToTop(map);
  reapplySatelliteImageryForStoredMapMode(map);
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
        "raster-opacity": 0.78,
        "raster-fade-duration": 220,
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
  source: string,
  frame: RadarFrame,
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
    const tileUrl = buildGibsTileUrl(source, frame.time);
    const src = map.getSource(GIBS_SOURCE_ID) as RasterTileSource | undefined;
    if (src && "setTiles" in src) {
      src.setTiles([tileUrl]);
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
