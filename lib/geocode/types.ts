export type GeocodeKind = "place" | "address" | "poi";

export type GeocodeAddressParts = Record<string, string | undefined>;

export type GeocodeSuggestion = {
  id: string;
  lat: number;
  lon: number;
  shortName: string;
  breadcrumb: string;
  displayLine: string;
  typeLabel: string;
  kind: GeocodeKind;
  zoom: number;
  source: "nominatim" | "photon";
};

/** Normalized upstream hit before merge/ranking. */
export type RawGeocodeHit = {
  id: string;
  lat: number;
  lon: number;
  displayName: string;
  osmClass: string;
  osmType: string;
  address: GeocodeAddressParts;
  source: "nominatim" | "photon";
};

export type Viewbox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export function parseViewboxParam(
  raw: string | null,
): Viewbox | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function viewboxCacheKey(viewbox: Viewbox | null): string {
  if (!viewbox) return "ph";
  const r = (n: number) => n.toFixed(2);
  return `${r(viewbox.west)},${r(viewbox.south)},${r(viewbox.east)},${r(viewbox.north)}`;
}

/** Intersect map bounds with PH; returns null if there is no overlap. */
export function clipViewboxToPh(
  viewbox: Viewbox,
  phBbox: [number, number, number, number],
): Viewbox | null {
  const [phWest, phSouth, phEast, phNorth] = phBbox;
  const west = Math.max(viewbox.west, phWest);
  const south = Math.max(viewbox.south, phSouth);
  const east = Math.min(viewbox.east, phEast);
  const north = Math.min(viewbox.north, phNorth);
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}
