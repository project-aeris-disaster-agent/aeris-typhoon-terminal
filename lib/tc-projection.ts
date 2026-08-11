/**
 * Projected storm motion from the data we actually have.
 *
 * Neither upstream gives us an official forward track today: the GDACS
 * eventlist carries only the historical best track (its `forecast` array maps
 * to empty), and the PAGASA daily advisory is prose. What both reliably give
 * us is *motion* — PAGASA as "WEST NORTHWESTWARD AT 30 KM/H", GDACS as a
 * compass heading derived from the last two track points.
 *
 * So the map draws a dead-reckoned projection: current position advanced
 * along a constant bearing. That is a straight-line extrapolation, NOT a
 * forecast — real tracks curve (recurvature is the norm in the WestPac). The
 * renderer styles it dashed and labels it "projected"; keep it that way. The
 * official PAGASA bulletin PDF remains the authority, one click away in the
 * tracker panel.
 *
 * When speed is known (PAGASA) the projection carries timed points so the
 * map can mark +12/+24/+48 h. When only a heading is known (GDACS) it is a
 * fixed-length direction ray with no time claims.
 */

import type { LngLat } from "@/config/region";

export type ProjectedPoint = {
  position: LngLat;
  /** Hours ahead of the advisory position; null for untimed direction rays. */
  hoursAhead: number | null;
};

export type StormMotion = {
  bearingDeg: number;
  /** null when the text gives a direction but no usable speed. */
  speedKph: number | null;
};

/** 16-point compass, degrees clockwise from north. */
const COMPASS_BEARING: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

/** Longest-phrase-first so "WEST NORTHWEST" wins over "NORTHWEST". */
const LONG_FORM: Array<[string, string]> = [
  ["NORTH NORTHEAST", "NNE"],
  ["EAST NORTHEAST", "ENE"],
  ["EAST SOUTHEAST", "ESE"],
  ["SOUTH SOUTHEAST", "SSE"],
  ["SOUTH SOUTHWEST", "SSW"],
  ["WEST SOUTHWEST", "WSW"],
  ["WEST NORTHWEST", "WNW"],
  ["NORTH NORTHWEST", "NNW"],
  ["NORTHEAST", "NE"],
  ["SOUTHEAST", "SE"],
  ["SOUTHWEST", "SW"],
  ["NORTHWEST", "NW"],
  ["NORTH", "N"],
  ["EAST", "E"],
  ["SOUTH", "S"],
  ["WEST", "W"],
];

/** "WNW" | "wnw" → 292.5. Null for anything not a 16-point code. */
export function bearingFromCompass(code: string | null | undefined): number | null {
  if (!code) return null;
  const bearing = COMPASS_BEARING[code.trim().toUpperCase()];
  return bearing === undefined ? null : bearing;
}

/**
 * Parse a PAGASA MOVEMENT field: "WEST NORTHWESTWARD AT 30 KM/H",
 * "Northwestward at 20 km/h", "MOVING WESTWARD SLOWLY". Returns null for
 * quasi-stationary systems and unrecognized text — a storm that is not going
 * anywhere must not get a projection ray.
 */
export function parseMovementText(text: string | null | undefined): StormMotion | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  if (/STATIONARY|QUASI[- ]?STATIONARY/.test(upper)) return null;

  // "WARD(S)" suffix and hyphens off, so "WEST-NORTHWESTWARD" → "WEST NORTHWEST".
  const normalized = upper.replace(/-/g, " ").replace(/WARDS?\b/g, "").replace(/\s+/g, " ");

  let bearingDeg: number | null = null;
  for (const [phrase, code] of LONG_FORM) {
    if (normalized.includes(phrase)) {
      bearingDeg = COMPASS_BEARING[code];
      break;
    }
  }
  if (bearingDeg === null) return null;

  const speedMatch = upper.match(/(\d+(?:\.\d+)?)\s*(?:KM\/?H|KPH)/);
  const speedKph = speedMatch ? Number(speedMatch[1]) : null;

  return {
    bearingDeg,
    speedKph: Number.isFinite(speedKph) && speedKph! > 0 ? speedKph : null,
  };
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle destination from a start point along a bearing. */
export function destinationPoint(
  start: LngLat,
  bearingDeg: number,
  distanceKm: number,
): LngLat {
  const [lng, lat] = start;
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lng * Math.PI) / 180;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return [((lambda2 * 180) / Math.PI + 540) % 360 - 180, (phi2 * 180) / Math.PI];
}

/** Time marks for a speed-known projection. 48 h is already optimistic for a
 * straight-line extrapolation; do not extend it. */
const TIMED_HOURS = [12, 24, 48] as const;

/** Ray length when only a heading is known. Roughly two days of typical
 * WestPac TC motion (~15 km/h) — long enough to read direction at PAR scale,
 * short enough not to imply a landfall point. */
export const HEADING_RAY_KM = 700;

/**
 * Build the projected path. Always starts at the advisory position; timed
 * points when speed is known, otherwise a single untimed ray endpoint.
 * Returns [] when there is no usable motion.
 */
export function buildProjectedPath(
  position: LngLat,
  motion: StormMotion | null,
): ProjectedPoint[] {
  if (!motion) return [];

  if (motion.speedKph) {
    return [
      { position, hoursAhead: 0 },
      ...TIMED_HOURS.map((hours) => ({
        position: destinationPoint(position, motion.bearingDeg, motion.speedKph! * hours),
        hoursAhead: hours as number,
      })),
    ];
  }

  return [
    { position, hoursAhead: 0 },
    {
      position: destinationPoint(position, motion.bearingDeg, HEADING_RAY_KM),
      hoursAhead: null,
    },
  ];
}

/** Arrowhead size scales with how far the projection reaches. */
const ARROW_KM_RATIO = 0.07;

/**
 * Triangle polygon marking the projection's direction at its tip. Built as
 * geometry (not a glyph) so it cannot break on basemap font availability and
 * rotates exactly with the bearing.
 */
export function buildArrowHead(
  tip: LngLat,
  bearingDeg: number,
  pathLengthKm: number,
): LngLat[] {
  const size = Math.max(18, pathLengthKm * ARROW_KM_RATIO);
  const base = destinationPoint(tip, (bearingDeg + 180) % 360, size);
  const left = destinationPoint(base, (bearingDeg + 270) % 360, size * 0.5);
  const right = destinationPoint(base, (bearingDeg + 90) % 360, size * 0.5);
  return [tip, left, right, tip];
}
