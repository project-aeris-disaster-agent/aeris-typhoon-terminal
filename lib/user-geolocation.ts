import { PH_BBOX } from "@/config/region";

export type GeoPoint = { lat: number; lon: number };

/** True when a WGS84 point lies inside the Philippines dashboard bbox. */
export function isWithinPhilippines(lon: number, lat: number): boolean {
  const [west, south, east, north] = PH_BBOX;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

export type UserGeolocationOptions = {
  timeoutMs?: number;
  maximumAgeMs?: number;
};

/**
 * Best-effort browser geolocation, clamped to the Philippines service area.
 * Resolves to `null` when unavailable, denied, timed out, or outside PH.
 */
export function getUserGeolocation(
  options: UserGeolocationOptions = {},
): Promise<GeoPoint | null> {
  const { timeoutMs = 8000, maximumAgeMs = 120_000 } = options;

  if (typeof window === "undefined" || !navigator?.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          resolve(null);
          return;
        }
        if (!isWithinPhilippines(lon, lat)) {
          resolve(null);
          return;
        }
        resolve({ lat, lon });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      },
    );
  });
}
