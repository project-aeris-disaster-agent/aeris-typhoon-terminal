import type {
  GeocodeAddressParts,
  GeocodeKind,
  GeocodeSuggestion,
  RawGeocodeHit,
} from "./types";

const PLACE_TYPE_LABEL: Record<string, string> = {
  house: "Address",
  building: "Building",
  residential: "Address",
  road: "Street",
  street: "Street",
  pedestrian: "Street",
  living_street: "Street",
  suburb: "Barangay",
  village: "Barangay",
  quarter: "Barangay",
  neighbourhood: "Barangay",
  hamlet: "Barangay",
  isolated_dwelling: "Barangay",
  allotments: "Barangay",
  town: "Town",
  city: "City",
  municipality: "Municipality",
  county: "Province",
  state: "Region",
  administrative: "Area",
};

export function classifyKind(
  osmClass: string,
  osmType: string,
  address: GeocodeAddressParts,
): GeocodeKind {
  if (address.house_number && address.road) return "address";
  if (
    osmClass === "highway" ||
    osmType === "road" ||
    osmType === "residential" ||
    osmType === "living_street" ||
    osmType === "pedestrian" ||
    osmType === "street"
  ) {
    return "address";
  }
  if (
    osmClass === "building" ||
    osmType === "house" ||
    osmType === "residential"
  ) {
    return "address";
  }
  if (address.road) return "address";
  if (
    ["amenity", "shop", "tourism", "leisure", "office", "historic"].includes(
      osmClass,
    )
  ) {
    return "poi";
  }
  if (
    osmClass === "place" ||
    osmClass === "boundary" ||
    [
      "suburb",
      "village",
      "city",
      "town",
      "municipality",
      "hamlet",
      "neighbourhood",
      "quarter",
      "county",
      "state",
    ].includes(osmType)
  ) {
    return "place";
  }
  return "poi";
}

export function shortNameFromAddress(
  address: GeocodeAddressParts,
  displayName: string,
): string {
  if (address.house_number && address.road) {
    return `${address.house_number} ${address.road}`;
  }
  if (address.road) return address.road;
  return (
    address.suburb ??
    address.village ??
    address.hamlet ??
    address.city_district ??
    address.town ??
    address.city ??
    address.county ??
    displayName.split(",")[0]?.trim() ??
    displayName
  );
}

export function breadcrumbFromAddress(address: GeocodeAddressParts): string {
  const parts: string[] = [];
  const sub = address.suburb ?? address.village ?? address.hamlet;
  if (sub) parts.push(sub);
  const city = address.city ?? address.town ?? address.municipality;
  if (city && city !== sub) parts.push(city);
  if (address.state && address.state !== city) parts.push(address.state);
  else if (address.county) parts.push(address.county);
  return parts.filter(Boolean).join(" · ");
}

export function typeLabelFor(osmClass: string, osmType: string): string {
  return PLACE_TYPE_LABEL[osmType] ?? PLACE_TYPE_LABEL[osmClass] ?? osmType;
}

export function zoomForKind(kind: GeocodeKind, osmType: string): number {
  if (kind === "address") {
    if (["house", "building", "residential"].includes(osmType)) return 17;
    return 16;
  }
  if (kind === "poi") return 16;
  if (["city", "municipality", "town"].includes(osmType)) return 12;
  if (
    ["suburb", "village", "hamlet", "neighbourhood", "quarter"].includes(
      osmType,
    )
  ) {
    return 14.5;
  }
  return 14;
}

export function hitToSuggestion(hit: RawGeocodeHit): GeocodeSuggestion {
  const kind = classifyKind(hit.osmClass, hit.osmType, hit.address);
  const shortName = shortNameFromAddress(hit.address, hit.displayName);
  const breadcrumb = breadcrumbFromAddress(hit.address);
  return {
    id: hit.id,
    lat: hit.lat,
    lon: hit.lon,
    shortName,
    breadcrumb,
    displayLine: hit.displayName,
    typeLabel: typeLabelFor(hit.osmClass, hit.osmType),
    kind,
    zoom: zoomForKind(kind, hit.osmType),
    source: hit.source,
  };
}

/** Secondary line in dropdown: breadcrumb or tail of full display name. */
export function suggestionSecondaryLine(s: GeocodeSuggestion): string {
  if (s.breadcrumb.length >= 8) return s.breadcrumb;
  const parts = s.displayLine.split(",").map((p) => p.trim());
  if (parts.length <= 1) return s.breadcrumb;
  const tail = parts.slice(1).join(", ");
  return tail || s.breadcrumb;
}
