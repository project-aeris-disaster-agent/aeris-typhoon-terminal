/**
 * Lightweight geo helpers. Kept dependency-free.
 */

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in kilometers between two WGS84 points. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_KM * c;
}

/**
 * Try to extract a (lat, lon) pair from a freeform PAGASA-style location
 * string like "1,260 KM EAST OF EASTERN VISAYAS (10.0°N, 137.2°E)".
 * Returns null when no coordinates are present.
 */
export function parseLatLonFromText(text: string): { lat: number; lon: number } | null {
  const normalized = text.replace(/&deg;/gi, "°");
  const match = normalized.match(
    /(-?\d+(?:\.\d+)?)\s*°?\s*([NS])\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])/i,
  );
  if (!match) return null;
  const lat = Number(match[1]) * (match[2].toUpperCase() === "S" ? -1 : 1);
  const lon = Number(match[3]) * (match[4].toUpperCase() === "W" ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
