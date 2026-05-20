"use client";

import type { LngLat } from "@/config/region";
import type { ForecastSummary } from "@/lib/forecast-alert";

export {
  computeForecastAlert,
  type ForecastAlert,
  type ForecastAlertLevel,
  type ForecastDay,
  type ForecastSummary,
} from "@/lib/forecast-alert";

export async function fetchForecast(coord: LngLat): Promise<ForecastSummary> {
  const [lng, lat] = coord;
  const url = `/api/open-meteo?lat=${lat}&lng=${lng}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}
