import { NextRequest } from "next/server";
import { PH_BBOX } from "@/config/region";
import { jsonError, jsonOk } from "@/lib/api-response";
import {
  clipViewboxToPh,
  fetchNominatim,
  fetchPhoton,
  parseViewboxParam,
  searchGeocode,
  viewboxCacheKey,
  type GeocodeSuggestion,
  type Viewbox,
} from "@/lib/geocode";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { store } from "@/lib/kv";

const MAX_QUERY_LEN = 120;
const CACHE_TTL_SECONDS = 24 * 60 * 60;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function isInsidePh(lat: number, lon: number): boolean {
  return (
    lon >= PH_BBOX[0] &&
    lon <= PH_BBOX[2] &&
    lat >= PH_BBOX[1] &&
    lat <= PH_BBOX[3]
  );
}

function resolveViewbox(raw: string | null): Viewbox | null {
  const parsed = parseViewboxParam(raw);
  if (!parsed) return null;
  return clipViewboxToPh(parsed, PH_BBOX);
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit({
    key: `geocode:${ip}`,
    max: 40,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return jsonError("Too many geocode requests", 429, {
      retryAfter: rl.resetSeconds,
    });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return jsonError("q must be at least 2 characters", 400);
  }
  if (q.length > MAX_QUERY_LEN) {
    return jsonError(`q must be at most ${MAX_QUERY_LEN} characters`, 400);
  }

  const viewbox = resolveViewbox(searchParams.get("viewbox"));

  const cacheKey = `geocode:v1:${normalizeQuery(q)}:${viewboxCacheKey(viewbox)}`;
  const cached = await store.get<GeocodeSuggestion[]>(cacheKey);
  if (cached) {
    return jsonOk({ suggestions: cached }, 300);
  }

  try {
    const suggestions = await searchGeocode(q, viewbox, {
      nominatim: fetchNominatim,
      photon: fetchPhoton,
    });

    const inPh = suggestions.filter((s) => isInsidePh(s.lat, s.lon));
    await store.set(cacheKey, inPh, CACHE_TTL_SECONDS);
    return jsonOk({ suggestions: inPh }, 300);
  } catch (e) {
    return jsonError((e as Error).message, 502);
  }
}
