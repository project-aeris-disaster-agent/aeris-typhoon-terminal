import type { GeocodeAddressParts, RawGeocodeHit, Viewbox } from "./types";

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  address?: GeocodeAddressParts;
};

export function nominatimUserAgent(): string {
  const contact =
    process.env.NOMINATIM_CONTACT_EMAIL?.trim() || "dev@localhost";
  return `AERIS-Dashboard/1.0 (contact: ${contact})`;
}

export async function fetchNominatim(
  query: string,
  viewbox: Viewbox | null,
): Promise<RawGeocodeHit[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "ph");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "15");
  if (viewbox) {
    url.searchParams.set(
      "viewbox",
      `${viewbox.west},${viewbox.north},${viewbox.east},${viewbox.south}`,
    );
    url.searchParams.set("bounded", "0");
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": nominatimUserAgent(),
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`nominatim HTTP ${res.status}`);
  }

  const data = (await res.json()) as NominatimResult[];
  const hits: RawGeocodeHit[] = [];
  for (const r of data) {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    hits.push({
      id: `nominatim:${r.place_id}`,
      lat,
      lon,
      displayName: r.display_name,
      osmClass: r.class,
      osmType: r.type,
      address: r.address ?? {},
      source: "nominatim",
    });
  }
  return hits;
}

export async function fetchNominatimReverse(
  lat: number,
  lon: number,
): Promise<RawGeocodeHit | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": nominatimUserAgent(),
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;

  const r = (await res.json()) as NominatimResult & { error?: string };
  if (r.error || !Number.isFinite(Number(r.lat)) || !Number.isFinite(Number(r.lon))) {
    return null;
  }

  return {
    id: `nominatim:${r.place_id}`,
    lat: Number(r.lat),
    lon: Number(r.lon),
    displayName: r.display_name,
    osmClass: r.class,
    osmType: r.type,
    address: r.address ?? {},
    source: "nominatim",
  };
}
