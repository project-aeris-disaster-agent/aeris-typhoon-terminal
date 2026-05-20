import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-response";
import { fetchOpenMeteoForecast } from "@/lib/open-meteo-server";
import { PH_BBOX } from "@/config/region";

export const runtime = "edge";

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

  try {
    const summary = await fetchOpenMeteoForecast([lng, lat]);
    return jsonOk(summary, 900);
  } catch (e) {
    return jsonError((e as Error).message, 502);
  }
}
