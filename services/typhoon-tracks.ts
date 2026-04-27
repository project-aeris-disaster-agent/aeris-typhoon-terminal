"use client";

import type { Map as MLMap } from "maplibre-gl";
import type { LngLat } from "@/config/region";
import { recordFailure, recordSuccess } from "@/services/data-freshness";

export type TyphoonPoint = {
  position: LngLat;
  time?: string | null;
  windKph?: number | null;
  pressureHpa?: number | null;
  radiusKm?: {
    kt60?: number;
    kt30?: number;
    kt15?: number;
  };
};

export type Typhoon = {
  id: string;
  name: string;
  localName?: string | null;
  category: string;
  position: LngLat;
  windKph: number;
  pressureHpa: number;
  heading?: string | null;
  landfallEta?: string | null;
  bestTrack: TyphoonPoint[];
  forecast: TyphoonPoint[];
};

export async function fetchActiveTyphoons(): Promise<{
  storms: Typhoon[];
  warning: string | null;
}> {
  try {
    const res = await fetch("/api/jtwc", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      storms?: Typhoon[];
      error?: string;
      _error?: string;
      _warning?: string;
    };

    if (!res.ok) {
      // recordFailure happens once, in the catch below.
      throw new Error(data.error ?? `JTWC proxy ${res.status}`);
    }

    const storms = Array.isArray(data.storms) ? data.storms : [];
    const warning =
      (typeof data._warning === "string" ? data._warning : null) ??
      (typeof data._error === "string" ? data._error : null);

    // `/api/jtwc` returns 200 with empty storms when upstream feeds fail; treat
    // that as "no systems in the tracker" for ops UX, not a thrown error.

    recordSuccess("typhoons");
    return { storms, warning };
  } catch (error) {
    recordFailure("typhoons", (error as Error).message);
    throw error;
  }
}

function trackSourceId(id: string, kind: "best" | "fcst" | "cone" | "point" | "rings") {
  return `typhoon-${id}-${kind}`;
}
function trackLayerId(id: string, kind: "best" | "fcst" | "cone" | "point" | "rings") {
  return `typhoon-lyr-${id}-${kind}`;
}

export function renderTyphoonOnMap(map: MLMap, storm: Typhoon) {
  const bestCoords = storm.bestTrack.map((p) => p.position);
  const fcstCoords = storm.forecast.map((p) => p.position);

  setOrUpdateGeoJson(map, trackSourceId(storm.id, "best"), {
    type: "Feature",
    geometry: { type: "LineString", coordinates: bestCoords },
    properties: {},
  });
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "fcst"), {
    type: "Feature",
    geometry: { type: "LineString", coordinates: fcstCoords },
    properties: {},
  });
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "cone"), {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [buildCone(storm.forecast)] },
    properties: {},
  });
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "point"), {
    type: "Feature",
    geometry: { type: "Point", coordinates: storm.position },
    properties: { name: storm.name, wind: storm.windKph },
  });
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "rings"), {
    type: "FeatureCollection",
    features: buildWindRings(storm),
  });

  ensureLayer(map, trackLayerId(storm.id, "cone"), {
    id: trackLayerId(storm.id, "cone"),
    type: "fill",
    source: trackSourceId(storm.id, "cone"),
    paint: {
      "fill-color": "#ff4d6d",
      "fill-opacity": 0.12,
    },
  });
  ensureLayer(map, trackLayerId(storm.id, "best"), {
    id: trackLayerId(storm.id, "best"),
    type: "line",
    source: trackSourceId(storm.id, "best"),
    paint: {
      "line-color": "#e8eef5",
      "line-width": 1.5,
      "line-opacity": 0.7,
    },
  });
  ensureLayer(map, trackLayerId(storm.id, "fcst"), {
    id: trackLayerId(storm.id, "fcst"),
    type: "line",
    source: trackSourceId(storm.id, "fcst"),
    paint: {
      "line-color": "#ff4d6d",
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });
  ensureLayer(map, trackLayerId(storm.id, "rings"), {
    id: trackLayerId(storm.id, "rings"),
    type: "line",
    source: trackSourceId(storm.id, "rings"),
    paint: {
      "line-color": [
        "match",
        ["get", "speed"],
        60,
        "#ff4d6d",
        30,
        "#ffb84d",
        15,
        "#3ddc97",
        "#8b98a9",
      ],
      "line-width": 1.25,
      "line-opacity": 0.65,
    },
  });
  ensureLayer(map, trackLayerId(storm.id, "point"), {
    id: trackLayerId(storm.id, "point"),
    type: "circle",
    source: trackSourceId(storm.id, "point"),
    paint: {
      "circle-radius": 6,
      "circle-color": "#ff4d6d",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
}

export function clearTyphoonFromMap(map: MLMap, id: string) {
  for (const k of ["best", "fcst", "cone", "point", "rings"] as const) {
    const lid = trackLayerId(id, k);
    if (map.getLayer(lid)) map.removeLayer(lid);
    const sid = trackSourceId(id, k);
    if (map.getSource(sid)) map.removeSource(sid);
  }
}

function setOrUpdateGeoJson(
  map: MLMap,
  id: string,
  data: GeoJSON.Feature | GeoJSON.FeatureCollection,
) {
  const existing = map.getSource(id);
  if (existing && "setData" in existing) {
    (existing as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(id, { type: "geojson", data });
  }
}

function ensureLayer(map: MLMap, id: string, spec: maplibregl.AddLayerObject) {
  if (map.getLayer(id)) return;
  // Anchor typhoon artifacts below facility labels so toponyms remain
  // readable, and so re-adds after clear/rebuild cycles stay in a stable
  // z-order relative to other dynamic layers (reports, hazards).
  const beforeId =
    typeof map.getLayer === "function" && map.getLayer("lyr-osm-facility-labels")
      ? "lyr-osm-facility-labels"
      : undefined;
  map.addLayer(spec, beforeId);
}

function buildCone(forecast: TyphoonPoint[]): LngLat[] {
  if (forecast.length === 0) return [];
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  for (let i = 0; i < forecast.length; i++) {
    const p = forecast[i];
    const widening = 0.15 + i * 0.12;
    left.push([p.position[0] - widening, p.position[1] + widening * 0.5]);
    right.push([p.position[0] + widening, p.position[1] - widening * 0.5]);
  }
  return [...left, ...right.reverse(), left[0]];
}

function buildWindRings(storm: Typhoon): GeoJSON.Feature[] {
  const [lng, lat] = storm.position;
  const rings: GeoJSON.Feature[] = [];
  const r = storm.bestTrack[storm.bestTrack.length - 1]?.radiusKm ?? {};
  const mapping: Array<[number, number | undefined]> = [
    [60, r.kt60],
    [30, r.kt30],
    [15, r.kt15],
  ];
  for (const [speed, radiusKm] of mapping) {
    if (!radiusKm) continue;
    rings.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [circlePolygon([lng, lat], radiusKm)],
      },
      properties: { speed },
    });
  }
  return rings;
}

function circlePolygon(center: LngLat, radiusKm: number, steps = 64): LngLat[] {
  const [lng, lat] = center;
  const coords: LngLat[] = [];
  const earth = 6371;
  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 2 * Math.PI) / steps;
    const dLat = (radiusKm / earth) * Math.cos(bearing);
    const dLng =
      (radiusKm / earth) *
      Math.sin(bearing) /
      Math.cos((lat * Math.PI) / 180);
    coords.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return coords;
}
