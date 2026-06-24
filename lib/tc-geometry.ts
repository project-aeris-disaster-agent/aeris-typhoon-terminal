import type { LngLat } from "@/config/region";
import { pointInRing } from "@/lib/facility-building-match";

export type TcForecastPoint = {
  position: LngLat;
};

/** Forecast cone polygon from JTWC-style forecast positions. */
export function buildForecastCone(forecast: TcForecastPoint[]): LngLat[] {
  if (forecast.length === 0) return [];
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  for (let i = 0; i < forecast.length; i++) {
    const p = forecast[i];
    const widening = 0.15 + i * 0.12;
    left.push([p.position[0] - widening, p.position[1] + widening * 0.5]);
    right.push([p.position[0] + widening, p.position[1] - widening * 0.5]);
  }
  return [...left, ...right.reverse(), left[0]];
}

export function circlePolygon(center: LngLat, radiusKm: number, steps = 64): LngLat[] {
  const [lng, lat] = center;
  const coords: LngLat[] = [];
  const earth = 6371;
  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 2 * Math.PI) / steps;
    const dLat = (radiusKm / earth) * Math.cos(bearing);
    const dLng =
      (radiusKm / earth) *
      Math.sin(bearing) /
      Math.cos((lat * Math.PI) / 180);
    coords.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return coords;
}

export function pointInForecastCone(
  lng: number,
  lat: number,
  forecast: TcForecastPoint[],
): boolean {
  const ring = buildForecastCone(forecast);
  if (ring.length < 3) return false;
  return pointInRing(ring, lng, lat);
}

export function pointInWindRadius(
  lng: number,
  lat: number,
  center: LngLat,
  radiusKm: number | undefined,
): boolean {
  if (!radiusKm || radiusKm <= 0) return false;
  const ring = circlePolygon(center, radiusKm);
  return pointInRing(ring, lng, lat);
}
