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

/** Discrete band derived from heat, rain, wind, and pressure over the 7-day window. */
export type ForecastAlertLevel = 0 | 1 | 2 | 3;

export type ForecastAlert = {
  level: ForecastAlertLevel;
  /** Sort key: higher = more conditions to watch. */
  score: number;
  label: string;
  tone: "ok" | "default" | "warn" | "danger";
};

/**
 * Heuristic severity for prioritizing regions (tropical baseline: warm + convective rain).
 * Not a replacement for official PAGASA warnings.
 */
export function computeForecastAlert(summary: ForecastSummary): ForecastAlert {
  const maxTemp = Math.max(...summary.daily.map((d) => d.tempMax), 0);
  const peakDailyRain = Math.max(...summary.daily.map((d) => d.rainMm), 0);
  const totalRain = summary.totalRainMm;
  const maxWind = summary.maxWindKph;
  const minPres = summary.minPressureHpa;

  let score = 0;

  if (maxTemp >= 39) score += 32;
  else if (maxTemp >= 37) score += 22;
  else if (maxTemp >= 35) score += 12;
  else if (maxTemp >= 33) score += 4;

  if (peakDailyRain >= 40) score += 28;
  else if (peakDailyRain >= 20) score += 18;
  else if (peakDailyRain >= 10) score += 10;
  else if (peakDailyRain >= 5) score += 4;

  if (totalRain >= 80) score += 22;
  else if (totalRain >= 40) score += 14;
  else if (totalRain >= 15) score += 6;

  if (maxWind >= 60) score += 26;
  else if (maxWind >= 45) score += 16;
  else if (maxWind >= 30) score += 8;
  else if (maxWind >= 22) score += 2;

  if (minPres <= 998) score += 18;
  else if (minPres <= 1002) score += 10;
  else if (minPres <= 1005) score += 4;

  let level: ForecastAlertLevel;
  let label: string;
  let tone: ForecastAlert["tone"];

  if (score < 12) {
    level = 0;
    label = "Low";
    tone = "ok";
  } else if (score < 28) {
    level = 1;
    label = "Moderate";
    tone = "default";
  } else if (score < 48) {
    level = 2;
    label = "Elevated";
    tone = "warn";
  } else {
    level = 3;
    label = "High";
    tone = "danger";
  }

  return { level, score, label, tone };
}

export async function fetchForecast(coord: LngLat): Promise<ForecastSummary> {
  const [lng, lat] = coord;
  const url = `/api/open-meteo?lat=${lat}&lng=${lng}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}
