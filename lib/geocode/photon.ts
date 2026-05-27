import { PH_BBOX } from "@/config/region";
import type { GeocodeAddressParts, RawGeocodeHit, Viewbox } from "./types";

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    country?: string;
    state?: string;
    county?: string;
    city?: string;
    district?: string;
    locality?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
  };
};

type PhotonResponse = {
  features: PhotonFeature[];
};

function photonAddress(props: PhotonFeature["properties"]): GeocodeAddressParts {
  return {
    house_number: props.housenumber,
    road: props.street,
    suburb: props.district ?? props.locality,
    city: props.city,
    county: props.county,
    state: props.state,
    country: props.country,
  };
}

function photonDisplayName(
  props: PhotonFeature["properties"],
  lon: number,
  lat: number,
): string {
  const parts = [
    props.housenumber && props.street
      ? `${props.housenumber} ${props.street}`
      : props.street,
    props.name,
    props.district ?? props.locality,
    props.city,
    props.state,
    props.country,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(", ");
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function photonClassType(props: PhotonFeature["properties"]): {
  osmClass: string;
  osmType: string;
} {
  const key = props.osm_key ?? "place";
  const value = props.osm_value ?? props.type ?? "locality";
  if (key === "highway") return { osmClass: "highway", osmType: value };
  if (key === "building") return { osmClass: "building", osmType: value };
  if (key === "place") return { osmClass: "place", osmType: value };
  if (props.type === "house" || props.housenumber) {
    return { osmClass: "building", osmType: "house" };
  }
  return { osmClass: key, osmType: value };
}

export async function fetchPhoton(
  query: string,
  viewbox: Viewbox | null,
): Promise<RawGeocodeHit[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("lang", "en");
  url.searchParams.set("limit", "10");

  const bbox = viewbox
    ? [viewbox.west, viewbox.south, viewbox.east, viewbox.north]
    : PH_BBOX;
  url.searchParams.set("bbox", bbox.join(","));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`photon HTTP ${res.status}`);
  }

  const data = (await res.json()) as PhotonResponse;
  return (data.features ?? []).map((f, i) => {
    const [lon, lat] = f.geometry.coordinates;
    const props = f.properties;
    const { osmClass, osmType } = photonClassType(props);
    const address = photonAddress(props);
    const osmId = props.osm_id ?? i;
    return {
      id: `photon:${props.osm_type ?? "N"}:${osmId}`,
      lat,
      lon,
      displayName: photonDisplayName(props, lon, lat),
      osmClass,
      osmType,
      address,
      source: "photon" as const,
    };
  });
}
