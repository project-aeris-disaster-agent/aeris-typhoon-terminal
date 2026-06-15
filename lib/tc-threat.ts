import { PAR_BBOX } from "@/config/region";

/**
 * Threat relevance for tropical cyclones outside the PAR.
 *
 * GDACS reports every active TC on the globe. For a Philippine ops dashboard we
 * only care about systems that could actually affect the country: those near
 * the PAR boundary, or further out but tracking toward it. This module scores a
 * storm's relevance from its position and recent motion so the tracker can show
 * *threats* rather than a raw global feed.
 */

const EARTH_KM = 6371;

/** Within this distance of the PAR boundary, a system is always worth showing. */
export const PAR_NEAR_KM = 1000;
/** Beyond PAR_NEAR_KM, only show systems that are approaching, out to this range. */
export const PAR_WATCH_KM = 3000;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Closest point on the PAR bounding box to the given position (clamped). */
export function nearestParPoint(lng: number, lat: number): [number, number] {
  const [minLng, minLat, maxLng, maxLat] = PAR_BBOX;
  return [
    Math.min(Math.max(lng, minLng), maxLng),
    Math.min(Math.max(lat, minLat), maxLat),
  ];
}

/** Great-circle distance (km) from a position to the nearest edge of PAR. */
export function parDistanceKm(lng: number, lat: number): number {
  return Math.round(haversineKm([lng, lat], nearestParPoint(lng, lat)));
}

/** Initial bearing (degrees, 0=N clockwise) from one position to another. */
export function initialBearing(
  from: [number, number],
  to: [number, number],
): number {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS_BEARING: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** Compass token (e.g. "NNW") → bearing degrees, or null if unrecognized. */
export function bearingFromCompass(
  compass: string | null | undefined,
): number | null {
  if (!compass) return null;
  const key = compass.trim().toUpperCase();
  return key in COMPASS_BEARING ? COMPASS_BEARING[key] : null;
}

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Storm motion bearing. Prefer the actual displacement between the last two
 * track points; fall back to a reported compass heading when only one point
 * (or no motion) is available.
 */
export function motionBearing(
  track: Array<[number, number]>,
  headingCompass: string | null | undefined,
): number | null {
  if (track.length >= 2) {
    const prev = track[track.length - 2];
    const cur = track[track.length - 1];
    if (!(prev[0] === cur[0] && prev[1] === cur[1])) {
      return initialBearing(prev, cur);
    }
  }
  return bearingFromCompass(headingCompass);
}

export type OutsideParThreat = {
  /** Distance (km) from the storm to the nearest edge of PAR. */
  distanceToParKm: number;
  /** Whether the system is tracking toward PAR. */
  approachingPar: boolean;
  /** Whether the system is relevant enough to surface as a monitor. */
  relevant: boolean;
};

/**
 * Assess whether an outside-PAR system is a threat worth monitoring.
 *
 * Relevant when it is close to PAR (within PAR_NEAR_KM) regardless of motion,
 * or further out (up to PAR_WATCH_KM) but tracking toward PAR.
 */
export function assessOutsideParThreat(args: {
  position: [number, number];
  track: Array<[number, number]>;
  heading: string | null | undefined;
}): OutsideParThreat {
  const [lng, lat] = args.position;
  const distanceToParKm = parDistanceKm(lng, lat);

  let approachingPar = false;

  if (args.track.length >= 2) {
    const prev = args.track[args.track.length - 2];
    const cur = args.track[args.track.length - 1];
    const prevDist = parDistanceKm(prev[0], prev[1]);
    const curDist = parDistanceKm(cur[0], cur[1]);
    if (prevDist !== curDist) {
      approachingPar = curDist < prevDist;
    } else {
      approachingPar = bearingPointsToPar(lng, lat, args.heading);
    }
  } else {
    approachingPar = bearingPointsToPar(lng, lat, args.heading);
  }

  const relevant =
    distanceToParKm <= PAR_NEAR_KM ||
    (distanceToParKm <= PAR_WATCH_KM && approachingPar);

  return { distanceToParKm, approachingPar, relevant };
}

function bearingPointsToPar(
  lng: number,
  lat: number,
  heading: string | null | undefined,
): boolean {
  const bearing = bearingFromCompass(heading);
  if (bearing == null) return false;
  const target = initialBearing([lng, lat], nearestParPoint(lng, lat));
  return angularDiff(bearing, target) <= 90;
}
