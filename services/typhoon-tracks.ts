"use client";

import type { Map as MLMap } from "maplibre-gl";
import { layerBeforeDynamicOverlays } from "@/config/map-layers";
import type { LngLat } from "@/config/region";
import { buildForecastCone, circlePolygon } from "@/lib/tc-geometry";
import {
  bearingFromCompass,
  buildArrowHead,
  buildProjectedPath,
  HEADING_RAY_KM,
  parseMovementText,
  type StormMotion,
} from "@/lib/tc-projection";
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
  gustKph?: number | null;
  heading?: string | null;
  landfallEta?: string | null;
  bestTrack: TyphoonPoint[];
  forecast: TyphoonPoint[];
  /** Distance (km) to PAR — only set for outside-PAR monitor systems. */
  distanceToParKm?: number;
  /** Whether an outside-PAR system is tracking toward PAR. */
  approachingPar?: boolean;
};

/** PAGASA Daily Weather — TC block when the system is outside PAR. */
export type OutsideParAdvisory = {
  source: "pagasa";
  name: string;
  location: string;
  maxWindsKmh?: string;
  gustinessKmh?: string;
  movement?: string;
  issuedAt: string | null;
  windKph: number | null;
  position: LngLat | null;
};

/** A single official PAGASA Tropical Cyclone Bulletin (index entry). */
export type PagasaBulletinItem = {
  name: string;
  number: number;
  final: boolean;
  file: string;
  pdfUrl: string;
  /** Latest SWB archive PDF while PAR is quiet. */
  archive?: boolean;
};

export type PagasaBulletinsFetchResult = {
  bulletins: PagasaBulletinItem[];
  fetchedAt: string | null;
  indexAgeSeconds: number | null;
  hasActive: boolean;
  quiet: boolean;
  stale: boolean;
  warning: string | null;
  /** True when the API could not return a bulletin payload. */
  unavailable: boolean;
};

const EMPTY_BULLETINS: PagasaBulletinsFetchResult = {
  bulletins: [],
  fetchedAt: null,
  indexAgeSeconds: null,
  hasActive: false,
  quiet: false,
  stale: false,
  warning: null,
  unavailable: true,
};

/**
 * Fetch the official PAGASA Tropical Cyclone Bulletin index from
 * `/api/pagasa-bulletins`. Returns empty metadata on failure — supplementary
 * link list, so it must never break the tracker.
 */
export async function fetchPagasaBulletins(options?: {
  refresh?: boolean;
}): Promise<PagasaBulletinsFetchResult> {
  try {
    const url = options?.refresh
      ? "/api/pagasa-bulletins?refresh=1"
      : "/api/pagasa-bulletins";
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      pagasaBulletins?: {
        bulletins?: PagasaBulletinItem[];
        fetchedAt?: string;
        indexAgeSeconds?: number | null;
        hasActive?: boolean;
        quiet?: boolean;
        stale?: boolean;
        warning?: string;
      } | null;
    };

    if (!res.ok || !data.ok || !data.pagasaBulletins) {
      recordFailure(
        "pagasa-bulletins",
        data.ok === false ? "index unavailable" : `HTTP ${res.status}`,
      );
      return EMPTY_BULLETINS;
    }

    recordSuccess("pagasa-bulletins");
    const payload = data.pagasaBulletins;
    return {
      bulletins: Array.isArray(payload.bulletins)
        ? payload.bulletins.map((b) => ({
            ...b,
            archive: b.archive === true,
          }))
        : [],
      fetchedAt: payload.fetchedAt ?? null,
      indexAgeSeconds:
        typeof payload.indexAgeSeconds === "number"
          ? payload.indexAgeSeconds
          : null,
      hasActive: payload.hasActive === true,
      quiet: payload.quiet === true,
      stale: payload.stale === true,
      warning: payload.warning ?? null,
      unavailable: false,
    };
  } catch (error) {
    recordFailure("pagasa-bulletins", (error as Error).message);
    return EMPTY_BULLETINS;
  }
}

export async function fetchActiveTyphoons(): Promise<{
  storms: Typhoon[];
  outsidePar: OutsideParAdvisory | null;
  outsideParGdacs: Typhoon[];
  warning: string | null;
}> {
  try {
    const res = await fetch("/api/jtwc", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      storms?: Typhoon[];
      outsidePar?: OutsideParAdvisory | null;
      outsideParGdacs?: Typhoon[];
      error?: string;
      _error?: string;
      _warning?: string;
    };

    if (!res.ok) {
      // recordFailure happens once, in the catch below.
      throw new Error(data.error ?? `JTWC proxy ${res.status}`);
    }

    const storms = Array.isArray(data.storms) ? data.storms : [];
    const outsidePar =
      data.outsidePar && typeof data.outsidePar === "object"
        ? data.outsidePar
        : null;
    const outsideParGdacs = Array.isArray(data.outsideParGdacs)
      ? data.outsideParGdacs
      : [];
    const warning =
      (typeof data._warning === "string" ? data._warning : null) ??
      (typeof data._error === "string" ? data._error : null);

    // `/api/jtwc` returns 200 with empty storms when upstream feeds fail; treat
    // that as "no systems in the tracker" for ops UX, not a thrown error.

    recordSuccess("typhoons");
    return { storms, outsidePar, outsideParGdacs, warning };
  } catch (error) {
    recordFailure("typhoons", (error as Error).message);
    throw error;
  }
}

type TrackKind =
  | "best"
  | "fcst"
  | "cone"
  | "point"
  | "rings"
  | "proj"
  | "projpts"
  | "arrow"
  | "label";

const TRACK_KINDS: readonly TrackKind[] = [
  "best",
  "fcst",
  "cone",
  "point",
  "rings",
  "proj",
  "projpts",
  "arrow",
  "label",
];

function trackSourceId(id: string, kind: TrackKind) {
  return `typhoon-${id}-${kind}`;
}
function trackLayerId(id: string, kind: TrackKind) {
  return `typhoon-lyr-${id}-${kind}`;
}

/**
 * Inside-PAR storms are the red operational threat; outside-PAR systems are
 * amber "monitoring" context. Same geometry pipeline, different urgency —
 * an operator glancing at the map must be able to tell which side of the PAR
 * line a system is on without reading a label.
 */
export type TyphoonRenderVariant = "par" | "monitor";

const VARIANT_STYLE: Record<
  TyphoonRenderVariant,
  { accent: string; track: string; trackOpacity: number }
> = {
  par: { accent: "#ff4d6d", track: "#e8eef5", trackOpacity: 0.7 },
  monitor: { accent: "#ffb84d", track: "#cbd5e1", trackOpacity: 0.5 },
};

/**
 * Motion for the projected ray. GDACS gives no forward speed, only a compass
 * heading (from `direction` or derived from the last two track points), so
 * storms project as an untimed direction ray. The PAGASA advisory path (see
 * renderOutsideParAdvisoryOnMap) has speed and gets timed marks instead.
 */
function motionForStorm(storm: Typhoon): StormMotion | null {
  const bearingDeg = bearingFromCompass(storm.heading ?? null);
  if (bearingDeg === null) return null;
  return { bearingDeg, speedKph: null };
}

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function projectionFeatures(
  position: LngLat,
  motion: StormMotion | null,
): { line: GeoJSON.FeatureCollection; points: GeoJSON.FeatureCollection; arrow: GeoJSON.FeatureCollection } {
  const path = buildProjectedPath(position, motion);
  if (path.length < 2 || !motion) {
    return { line: EMPTY_COLLECTION, points: EMPTY_COLLECTION, arrow: EMPTY_COLLECTION };
  }

  const coords = path.map((p) => p.position);
  const tip = coords[coords.length - 1];
  const lengthKm = motion.speedKph
    ? motion.speedKph * (path[path.length - 1].hoursAhead ?? 0)
    : HEADING_RAY_KM;

  return {
    line: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: {},
        },
      ],
    },
    points: {
      type: "FeatureCollection",
      features: path
        .filter((p) => p.hoursAhead !== null && p.hoursAhead > 0)
        .map((p) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: p.position },
          properties: { t: `+${p.hoursAhead}h` },
        })),
    },
    arrow: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [buildArrowHead(tip, motion.bearingDeg, lengthKm)],
          },
          properties: {},
        },
      ],
    },
  };
}

export function renderTyphoonOnMap(
  map: MLMap,
  storm: Typhoon,
  opts?: { variant?: TyphoonRenderVariant },
) {
  const variant = opts?.variant ?? "par";
  const style = VARIANT_STYLE[variant];
  const bestCoords = storm.bestTrack.map((p) => p.position);
  const fcstCoords = storm.forecast.map((p) => p.position);
  const projection = projectionFeatures(storm.position, motionForStorm(storm));

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
    geometry: { type: "Polygon", coordinates: [buildForecastCone(storm.forecast)] },
    properties: {},
  });
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "point"), {
    type: "Feature",
    geometry: { type: "Point", coordinates: storm.position },
    properties: {
      name: storm.name,
      wind: storm.windKph,
      label: stormMapLabel(storm, variant),
    },
  });
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "rings"), {
    type: "FeatureCollection",
    features: buildWindRings(storm),
  });
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "proj"), projection.line);
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "projpts"), projection.points);
  setOrUpdateGeoJson(map, trackSourceId(storm.id, "arrow"), projection.arrow);

  ensureLayer(map, trackLayerId(storm.id, "cone"), {
    id: trackLayerId(storm.id, "cone"),
    type: "fill",
    source: trackSourceId(storm.id, "cone"),
    paint: {
      "fill-color": style.accent,
      "fill-opacity": 0.12,
    },
  });
  ensureLayer(map, trackLayerId(storm.id, "best"), {
    id: trackLayerId(storm.id, "best"),
    type: "line",
    source: trackSourceId(storm.id, "best"),
    paint: {
      "line-color": style.track,
      "line-width": 1.5,
      "line-opacity": style.trackOpacity,
    },
  });
  ensureLayer(map, trackLayerId(storm.id, "fcst"), {
    id: trackLayerId(storm.id, "fcst"),
    type: "line",
    source: trackSourceId(storm.id, "fcst"),
    paint: {
      "line-color": style.accent,
      "line-width": 2,
      "line-dasharray": [2, 2],
    },
  });
  addProjectionLayers(map, storm.id, style.accent);
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
      "circle-color": style.accent,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  // Same pattern as the barangay labels (services/admin-boundaries.ts): no
  // text-font, so the basemap style's default glyph stack is used and a font
  // mismatch cannot blank the label.
  ensureLayer(map, trackLayerId(storm.id, "label"), {
    id: trackLayerId(storm.id, "label"),
    type: "symbol",
    source: trackSourceId(storm.id, "point"),
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 1.1],
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": style.accent,
      "text-halo-color": "#0b1220",
      "text-halo-width": 1.4,
    },
  });
}

/** Projected-motion layers: dashed ray, timed marks, direction arrowhead. */
function addProjectionLayers(map: MLMap, id: string, accent: string) {
  ensureLayer(map, trackLayerId(id, "proj"), {
    id: trackLayerId(id, "proj"),
    type: "line",
    source: trackSourceId(id, "proj"),
    paint: {
      "line-color": accent,
      "line-width": 1.75,
      // Tighter dash than the (currently always-empty) forecast layer, so if a
      // real forecast track ever lights up the two read differently.
      "line-dasharray": [1, 2],
      "line-opacity": 0.85,
    },
  });
  ensureLayer(map, trackLayerId(id, "arrow"), {
    id: trackLayerId(id, "arrow"),
    type: "fill",
    source: trackSourceId(id, "arrow"),
    paint: {
      "fill-color": accent,
      "fill-opacity": 0.85,
    },
  });
  ensureLayer(map, trackLayerId(id, "projpts"), {
    id: trackLayerId(id, "projpts"),
    type: "symbol",
    source: trackSourceId(id, "projpts"),
    layout: {
      "text-field": ["get", "t"],
      "text-size": 9,
      "text-anchor": "bottom",
      "text-offset": [0, -0.4],
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": accent,
      "text-halo-color": "#0b1220",
      "text-halo-width": 1.2,
      "text-opacity": 0.9,
    },
  });
}

function stormMapLabel(storm: Typhoon, variant: TyphoonRenderVariant): string {
  const heading = storm.heading ? ` → ${storm.heading}` : "";
  if (variant === "monitor") {
    const distance = storm.distanceToParKm
      ? ` · ${Math.round(storm.distanceToParKm)} km to PAR`
      : "";
    return `${storm.name}${heading}${distance}\nOUTSIDE PAR — MONITORING`;
  }
  return `${storm.name} · ${storm.windKph} km/h${heading}`;
}

export function clearTyphoonFromMap(map: MLMap, id: string) {
  // Two passes, all layers before any source: the label layer renders from the
  // *point* source, so interleaving layer/source removal per kind hits
  // MapLibre's "source cannot be removed while a layer is using it" error the
  // moment the point source is removed with the label layer still attached.
  for (const k of TRACK_KINDS) {
    const lid = trackLayerId(id, k);
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  for (const k of TRACK_KINDS) {
    const sid = trackSourceId(id, k);
    if (map.getSource(sid)) map.removeSource(sid);
  }
}

/**
 * Fixed pseudo-id for the PAGASA outside-PAR advisory storm. The advisory is
 * a singleton in the payload (see /api/jtwc finalizeJtwcPayload — when PAGASA
 * covers a system, GDACS monitors are suppressed, so the same storm is never
 * drawn twice).
 */
const PAGASA_ADVISORY_MAP_ID = "pagasa-outside-par";

/**
 * Render the PAGASA outside-PAR advisory on the map. Unlike GDACS storms it
 * has no track, but it is the one source with a stated speed ("NORTHWESTWARD
 * AT 20 KM/H"), so its projection carries +12/+24/+48 h marks. No-op when the
 * advisory's location text did not parse to coordinates.
 */
export function renderOutsideParAdvisoryOnMap(
  map: MLMap,
  advisory: OutsideParAdvisory,
) {
  if (!advisory.position) return;

  const id = PAGASA_ADVISORY_MAP_ID;
  const style = VARIANT_STYLE.monitor;
  const motion = parseMovementText(advisory.movement);
  const projection = projectionFeatures(advisory.position, motion);
  const windLabel = advisory.windKph ? ` · ${advisory.windKph} km/h` : "";

  setOrUpdateGeoJson(map, trackSourceId(id, "point"), {
    type: "Feature",
    geometry: { type: "Point", coordinates: advisory.position },
    properties: {
      name: advisory.name,
      label: `${advisory.name}${windLabel}\nOUTSIDE PAR — PAGASA ADVISORY`,
    },
  });
  setOrUpdateGeoJson(map, trackSourceId(id, "proj"), projection.line);
  setOrUpdateGeoJson(map, trackSourceId(id, "projpts"), projection.points);
  setOrUpdateGeoJson(map, trackSourceId(id, "arrow"), projection.arrow);

  addProjectionLayers(map, id, style.accent);
  ensureLayer(map, trackLayerId(id, "point"), {
    id: trackLayerId(id, "point"),
    type: "circle",
    source: trackSourceId(id, "point"),
    paint: {
      "circle-radius": 6,
      "circle-color": style.accent,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  ensureLayer(map, trackLayerId(id, "label"), {
    id: trackLayerId(id, "label"),
    type: "symbol",
    source: trackSourceId(id, "point"),
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-anchor": "top",
      "text-offset": [0, 1.1],
      "text-allow-overlap": false,
      "text-padding": 4,
    },
    paint: {
      "text-color": style.accent,
      "text-halo-color": "#0b1220",
      "text-halo-width": 1.4,
    },
  });
}

export function clearOutsideParAdvisoryFromMap(map: MLMap) {
  clearTyphoonFromMap(map, PAGASA_ADVISORY_MAP_ID);
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
  map.addLayer(spec, layerBeforeDynamicOverlays(map));
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

