import type { SelectedLocation } from "@/components/MapSearchBar";
import type { GeocodeSuggestion } from "@/lib/geocode";
import { getUserGeolocation } from "@/lib/user-geolocation";

function coordsFallback(lat: number, lon: number): SelectedLocation {
  return {
    lat,
    lon,
    shortName: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    breadcrumb: "Your location",
    typeLabel: "Area",
    kind: "place",
    zoom: 14,
  };
}

function suggestionToSelected(s: GeocodeSuggestion): SelectedLocation {
  return {
    lat: s.lat,
    lon: s.lon,
    shortName: s.shortName,
    breadcrumb: s.breadcrumb,
    typeLabel: s.typeLabel,
    kind: s.kind,
    zoom: s.zoom,
  };
}

async function reverseGeocodeSelectedLocation(
  lat: number,
  lon: number,
): Promise<SelectedLocation> {
  try {
    const res = await fetch(
      `/api/geocode/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const data = (await res.json()) as { suggestion?: GeocodeSuggestion };
      if (data.suggestion) return suggestionToSelected(data.suggestion);
    }
  } catch {
    // fall through to coordinate label
  }
  return coordsFallback(lat, lon);
}

/**
 * On first dashboard load, resolve the user's position (PH only) and open
 * the location info panel with a reverse-geocoded label when possible.
 * Does not move the map — recenter only happens on explicit search.
 */
export async function resolveUserLocationOnLoad(
  getCurrentLocation: () => SelectedLocation | null,
  onSelect: (loc: SelectedLocation) => void,
): Promise<void> {
  const point = await getUserGeolocation();
  if (!point || getCurrentLocation() !== null) return;

  const location = await reverseGeocodeSelectedLocation(point.lat, point.lon);
  if (getCurrentLocation() !== null) return;

  onSelect(location);
}
