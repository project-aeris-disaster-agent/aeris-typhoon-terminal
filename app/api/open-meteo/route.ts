import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-response";
import { fetchOpenMeteoForecast } from "@/lib/open-meteo-server";
import { store } from "@/lib/kv";
import type { ForecastSummary } from "@/lib/forecast-alert";
import { PH_BBOX } from "@/config/region";

export const runtime = "edge";

/** Keep the last good forecast per coordinate to ride out Open-Meteo outages. */
const STALE_TTL_SECONDS = 6 * 60 * 60;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");

  if (latParam === null || lngParam === null) {
    return jsonError("lat and lng required", 400);
  }

  const lat = Number(latParam);
  const lng = Number(lngParam);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonError("lat and lng required", 400);
  }
  if (
    lng < PH_BBOX[0] ||
    lng > PH_BBOX[2] ||
    lat < PH_BBOX[1] ||
    lat > PH_BBOX[3]
  ) {
    return jsonError("coordinate outside Philippines", 400);
  }

  const staleKey = `open-meteo-stale:${lat.toFixed(4)},${lng.toFixed(4)}`;

  try {
    const summary = await fetchOpenMeteoForecast([lng, lat]);
    await store.set(staleKey, summary, STALE_TTL_SECONDS);
    return jsonOk(summary, 900);
  } catch (e) {
    const stale = await store.get<ForecastSummary>(staleKey);
    if (stale) {
      return jsonOk({ ...stale, degraded: true }, 120);
    }
    return jsonError((e as Error).message, 502);
  }
}
