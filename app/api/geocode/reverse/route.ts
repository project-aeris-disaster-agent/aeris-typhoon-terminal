import { NextRequest } from "next/server";
import { PH_BBOX } from "@/config/region";
import { jsonError, jsonOk } from "@/lib/api-response";
import {
  fetchNominatimReverse,
  hitToSuggestion,
} from "@/lib/geocode";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

function isInsidePh(lat: number, lon: number): boolean {
  return (
    lon >= PH_BBOX[0] &&
    lon <= PH_BBOX[2] &&
    lat >= PH_BBOX[1] &&
    lat <= PH_BBOX[3]
  );
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit({
    key: `geocode-reverse:${ip}`,
    max: 30,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return jsonError("Too many geocode requests", 429, {
      retryAfter: rl.resetSeconds,
    });
  }

  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return jsonError("lat and lon must be finite numbers", 400);
  }
  if (!isInsidePh(lat, lon)) {
    return jsonError("coordinates outside Philippines service area", 400);
  }

  try {
    const hit = await fetchNominatimReverse(lat, lon);
    if (!hit) {
      return jsonError("reverse geocode failed", 502);
    }
    return jsonOk({ suggestion: hitToSuggestion(hit) }, 300);
  } catch (e) {
    return jsonError((e as Error).message, 502);
  }
}
