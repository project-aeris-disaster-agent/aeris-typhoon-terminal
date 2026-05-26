/**
 * Heuristic geocoder for CCTV livestream titles. Produces a rough (lat, lon)
 * for the camera so we can drop a ping on the map.
 *
 * Strategy
 * --------
 * 1. Try barangay/neighborhood matches first (more specific than city).
 * 2. Fall back to city-level centroids.
 * 3. Use a tiny deterministic jitter keyed by the video id so multiple
 *    cameras at the same neighborhood don't stack on a single pixel.
 *
 * All coordinates were sourced from public OSM/Wikipedia data and are
 * accurate to ~city block precision — sufficient for "this camera is in
 * Agdao, Davao" but not for street-level routing.
 */

export type CctvLocation = {
  lat: number;
  lon: number;
  /** Human-readable label shown in popup/panel (e.g. "Agdao, Davao City") */
  label: string;
  /** "barangay" > "city" — used to size the ping and order match priority. */
  confidence: "barangay" | "city";
};

type Place = {
  /** Canonical name shown in the label */
  name: string;
  /** Lower-cased aliases that may appear in titles */
  aliases: string[];
  lat: number;
  lon: number;
  /** Where this place sits administratively (used to suffix the label) */
  parent?: string;
};

/**
 * Barangay / neighborhood granularity. Order doesn't matter because we sort
 * matches by alias-string length to prefer the most specific hit.
 */
const BARANGAYS: Place[] = [
  // --- Davao City ---
  { name: "Agdao", aliases: ["agdao"], lat: 7.0856, lon: 125.6232, parent: "Davao City" },
  {
    name: "Bankerohan",
    aliases: ["bankerohan"],
    lat: 7.0628,
    lon: 125.6023,
    parent: "Davao City",
  },
  {
    name: "Soliman St., Agdao",
    aliases: ["soliman street", "soliman st", "soliman"],
    lat: 7.0879,
    lon: 125.6261,
    parent: "Davao City",
  },
  {
    name: "F. Bangoy St., Agdao",
    aliases: ["f bangoy", "f. bangoy", "bangoy street"],
    lat: 7.0894,
    lon: 125.6244,
    parent: "Davao City",
  },
  {
    name: "Leon Garcia St., Agdao",
    aliases: ["leon garcia"],
    lat: 7.0925,
    lon: 125.6228,
    parent: "Davao City",
  },
  {
    name: "Roxas Avenue",
    aliases: ["roxas avenue", "roxas ave"],
    lat: 7.0731,
    lon: 125.6107,
    parent: "Davao City",
  },
  {
    name: "Lapu-Lapu St., Agdao",
    aliases: ["lapu lapu", "lapu-lapu"],
    lat: 7.0901,
    lon: 125.6213,
    parent: "Davao City",
  },
  {
    name: "San Roque, Agdao",
    aliases: ["san roque"],
    lat: 7.0867,
    lon: 125.6275,
    parent: "Davao City",
  },
  {
    name: "Kapitan Tomas Monteverde, Agdao",
    aliases: ["kapitan tomas monteverde", "tomas monteverde"],
    lat: 7.0913,
    lon: 125.6219,
    parent: "Davao City",
  },

  // --- Metro Manila barangays / districts (ready for future channels) ---
  { name: "Quiapo, Manila", aliases: ["quiapo"], lat: 14.5994, lon: 120.9836 },
  { name: "Binondo, Manila", aliases: ["binondo"], lat: 14.6, lon: 120.9748 },
  { name: "Intramuros, Manila", aliases: ["intramuros"], lat: 14.5895, lon: 120.9748 },
  { name: "Makati CBD", aliases: ["ayala avenue", "ayala ave", "makati cbd"], lat: 14.5547, lon: 121.0244 },
  { name: "BGC, Taguig", aliases: ["bgc", "bonifacio global"], lat: 14.5507, lon: 121.0487 },
  { name: "Cubao, Quezon City", aliases: ["cubao"], lat: 14.6196, lon: 121.0537 },
];

/** Major-city centroids (fall-back). Order: longest alias first to win ties. */
const CITIES: Place[] = [
  { name: "Davao City", aliases: ["davao city", "davao"], lat: 7.1907, lon: 125.4553 },
  { name: "Metro Manila", aliases: ["metro manila", "ncr"], lat: 14.5995, lon: 120.9842 },
  { name: "Manila", aliases: ["manila"], lat: 14.5995, lon: 120.9842 },
  { name: "Quezon City", aliases: ["quezon city"], lat: 14.676, lon: 121.0437 },
  { name: "Makati", aliases: ["makati"], lat: 14.5547, lon: 121.0244 },
  { name: "Taguig", aliases: ["taguig"], lat: 14.5176, lon: 121.0509 },
  { name: "Pasig", aliases: ["pasig"], lat: 14.5764, lon: 121.0851 },
  { name: "Cebu City", aliases: ["cebu city", "cebu"], lat: 10.3157, lon: 123.8854 },
  { name: "Iloilo City", aliases: ["iloilo city", "iloilo"], lat: 10.7202, lon: 122.5621 },
  { name: "Bacolod", aliases: ["bacolod"], lat: 10.6713, lon: 122.9511 },
  { name: "Tacloban", aliases: ["tacloban"], lat: 11.244, lon: 125.006 },
  { name: "Legazpi", aliases: ["legazpi", "legaspi"], lat: 13.1391, lon: 123.7342 },
  { name: "Naga", aliases: ["naga city", "naga"], lat: 13.6218, lon: 123.1948 },
  { name: "Baguio", aliases: ["baguio"], lat: 16.4023, lon: 120.5979 },
  { name: "Zamboanga", aliases: ["zamboanga"], lat: 6.9214, lon: 122.079 },
  { name: "Cagayan de Oro", aliases: ["cagayan de oro", "cdo"], lat: 8.4542, lon: 124.6319 },
  { name: "General Santos", aliases: ["general santos", "gensan"], lat: 6.1164, lon: 125.1716 },
  { name: "Puerto Princesa", aliases: ["puerto princesa"], lat: 9.7392, lon: 118.7353 },
  { name: "Boracay", aliases: ["boracay"], lat: 11.9685, lon: 121.9272 },
  { name: "Siargao", aliases: ["siargao"], lat: 9.8601, lon: 126.0581 },
  { name: "Batanes", aliases: ["batanes", "basco"], lat: 20.4488, lon: 121.9731 },
];

/**
 * Deterministic small jitter so multiple cameras in the same barangay don't
 * stack on a single pixel. Keyed off the video id, output range ≈ ±0.0008°
 * (~80 m) — large enough to separate pings, small enough that all cameras
 * stay in the right neighborhood.
 */
function jitterFromId(id: string): { dLat: number; dLon: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Two pseudo-random numbers in [-1, 1] from one 32-bit hash.
  const a = ((h & 0xffff) / 0xffff) * 2 - 1;
  const b = (((h >>> 16) & 0xffff) / 0xffff) * 2 - 1;
  return { dLat: a * 0.0008, dLon: b * 0.0008 };
}

function findPlace(haystack: string, places: Place[]): Place | null {
  let best: { place: Place; aliasLen: number } | null = null;
  for (const p of places) {
    for (const alias of p.aliases) {
      if (haystack.includes(alias)) {
        if (!best || alias.length > best.aliasLen) {
          best = { place: p, aliasLen: alias.length };
        }
      }
    }
  }
  return best?.place ?? null;
}

/**
 * Extract a CCTV ping location from a video title. Returns null if neither a
 * barangay nor a city was matched — the caller should NOT show a ping in that
 * case rather than guess.
 */
export function extractCctvLocation(
  title: string,
  videoId: string,
): CctvLocation | null {
  const norm = title.toLowerCase();

  const barangay = findPlace(norm, BARANGAYS);
  const city = findPlace(norm, CITIES);

  if (!barangay && !city) return null;

  const place = barangay ?? city!;
  const { dLat, dLon } = jitterFromId(videoId);

  // Build label: "<barangay>, <parent>" if parent differs from name; else
  // fall back to city. Strip duplicate substrings so "Agdao, Davao City"
  // doesn't render as "Agdao, Davao City, Davao City".
  let label = place.name;
  if (barangay && city && !place.name.toLowerCase().includes(city.name.toLowerCase())) {
    label = `${place.name}, ${city.name}`;
  } else if (barangay && barangay.parent && !place.name.toLowerCase().includes(barangay.parent.toLowerCase())) {
    label = `${place.name}, ${barangay.parent}`;
  }

  return {
    lat: place.lat + dLat,
    lon: place.lon + dLon,
    label,
    confidence: barangay ? "barangay" : "city",
  };
}
