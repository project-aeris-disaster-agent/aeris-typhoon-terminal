"use client";

import type { LngLat } from "@/config/region";

export type ForecastDay = {
  date: string;
  tempMin: number;
  tempMax: number;
  rainMm: number;
  windKph: number;
  pressureHpa: number;
};

export type ForecastSummary = {
  maxWindKph: number;
  totalRainMm: number;
  minPressureHpa: number;
  daily: ForecastDay[];
};

export async function fetchForecast(coord: LngLat): Promise<ForecastSummary> {
  const [lng, lat] = coord;
  const url = `/api/open-meteo?lat=${lat}&lng=${lng}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}
