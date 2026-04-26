"use client";

import type { Map as MLMap } from "maplibre-gl";
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

const GIBS_BASE =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png";

const GIBS_LAYER_MAP: Record<string, string> = {
  "himawari-true": "AHI_Geocolor",
  "himawari-ir": "AHI_Band13_Clean_Infrared_Brightness_Temperature",
};

const GIBS_SOURCE_ID = "src-gibs";
const GIBS_LAYER_ID = "lyr-gibs";
const RADAR_SOURCE_ID = "src-radar";
const RADAR_LAYER_ID = "lyr-radar";

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

export function ensureGibsLayer(map: MLMap, sourceKey: string) {
  if (map.getLayer(GIBS_LAYER_ID)) map.removeLayer(GIBS_LAYER_ID);
  if (map.getSource(GIBS_SOURCE_ID)) map.removeSource(GIBS_SOURCE_ID);
  if (map.getLayer(RADAR_LAYER_ID)) {
    map.setLayoutProperty(RADAR_LAYER_ID, "visibility", "none");
  }

  const layer = GIBS_LAYER_MAP[sourceKey] ?? GIBS_LAYER_MAP["himawari-true"];
  const today = new Date().toISOString().slice(0, 10);
  const tileUrl = GIBS_BASE.replace("{layer}", layer).replace("{time}", today);

  map.addSource(GIBS_SOURCE_ID, {
    type: "raster",
    tiles: [tileUrl],
    tileSize: 256,
    attribution: "NASA GIBS / Himawari-9",
  });
  map.addLayer({
    id: GIBS_LAYER_ID,
    type: "raster",
    source: GIBS_SOURCE_ID,
    paint: { "raster-opacity": 0.8 },
  });
}

export function ensureRadarLayer(map: MLMap, frame?: RadarFrame) {
  if (map.getLayer(GIBS_LAYER_ID)) {
    map.setLayoutProperty(GIBS_LAYER_ID, "visibility", "none");
  }
  const url = frame ? radarTileUrl(frame) : null;
  if (!map.getSource(RADAR_SOURCE_ID)) {
    if (!url) return;
    map.addSource(RADAR_SOURCE_ID, {
      type: "raster",
      tiles: [url],
      tileSize: 256,
      attribution: "RainViewer",
    });
    map.addLayer({
      id: RADAR_LAYER_ID,
      type: "raster",
      source: RADAR_SOURCE_ID,
      paint: { "raster-opacity": 0.7 },
    });
  } else {
    map.setLayoutProperty(RADAR_LAYER_ID, "visibility", "visible");
    const src = map.getSource(RADAR_SOURCE_ID) as maplibregl.RasterTileSource | undefined;
    if (src && "setTiles" in src && url) {
      src.setTiles([url]);
    }
  }
}

export function setFrameTimestamp(
  map: MLMap,
  source: string,
  frame: RadarFrame,
) {
  if (source === "radar") {
    const url = radarTileUrl(frame);
    const src = map.getSource(RADAR_SOURCE_ID) as maplibregl.RasterTileSource | undefined;
    if (src && "setTiles" in src) {
      src.setTiles([url]);
    } else if (url) {
      ensureRadarLayer(map, frame);
    }
  } else {
    const layer = GIBS_LAYER_MAP[source] ?? GIBS_LAYER_MAP["himawari-true"];
    const date = new Date(frame.time);
    const isoDate = date.toISOString().slice(0, 10);
    const tileUrl = GIBS_BASE.replace("{layer}", layer).replace("{time}", isoDate);
    const src = map.getSource(GIBS_SOURCE_ID) as maplibregl.RasterTileSource | undefined;
    if (src && "setTiles" in src) {
      src.setTiles([tileUrl]);
    }
  }
}

function radarTileUrl(frame: RadarFrame) {
  if (!frame.path) return "";
  return `${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
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
