import { haversineKm } from "@/lib/geo";
import { hitToSuggestion } from "./labels";
import type {
  GeocodeKind,
  GeocodeSuggestion,
  RawGeocodeHit,
  Viewbox,
} from "./types";

const STREET_TOKENS = new Set([
  "st",
  "street",
  "ave",
  "avenue",
  "rd",
  "road",
  "blvd",
  "boulevard",
  "drive",
  "dr",
  "lane",
  "ln",
  "highway",
  "hwy",
]);

const DEDUPE_KM = 0.08;
const MAX_RESULTS = 10;

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function queryTokens(q: string): string[] {
  return normalizeQuery(q).split(" ").filter(Boolean);
}

function looksLikeAddressQuery(q: string): boolean {
  if (/\d/.test(q)) return true;
  return queryTokens(q).some((t) => STREET_TOKENS.has(t));
}

function looksLikePlaceQuery(q: string): boolean {
  return !looksLikeAddressQuery(q);
}

function textScore(query: string, hit: RawGeocodeHit): number {
  const q = normalizeQuery(query);
  const short = hit.displayName.split(",")[0]?.trim().toLowerCase() ?? "";
  const full = hit.displayName.toLowerCase();
  const tokens = queryTokens(query);

  if (!q) return 0;
  if (short === q || full.startsWith(q)) return 1;
  if (short.startsWith(q)) return 0.9;
  if (tokens.length > 0 && tokens.every((t) => full.includes(t))) return 0.75;
  if (full.includes(q)) return 0.5;
  return 0.2;
}

function kindBoost(kind: GeocodeKind, query: string): number {
  if (looksLikeAddressQuery(query) && kind === "address") return 0.15;
  if (looksLikePlaceQuery(query) && kind === "place") return 0.15;
  return 0;
}

type Scored = {
  hit: RawGeocodeHit;
  suggestion: GeocodeSuggestion;
  score: number;
};

function dedupeHits(scored: Scored[]): Scored[] {
  const kept: Scored[] = [];
  for (const item of scored) {
    const dup = kept.find((k) => {
      const km = haversineKm(
        { lat: item.hit.lat, lon: item.hit.lon },
        { lat: k.hit.lat, lon: k.hit.lon },
      );
      if (km > DEDUPE_KM) return false;
      const a = item.suggestion.shortName.toLowerCase();
      const b = k.suggestion.shortName.toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    if (!dup) {
      kept.push(item);
      continue;
    }
    if (item.score > dup.score) {
      const idx = kept.indexOf(dup);
      kept[idx] = item;
    }
  }
  return kept;
}

function interleaveBalanced(scored: Scored[]): Scored[] {
  const places = scored
    .filter((s) => s.suggestion.kind === "place")
    .sort((a, b) => b.score - a.score);
  const others = scored
    .filter((s) => s.suggestion.kind !== "place")
    .sort((a, b) => b.score - a.score);

  if (places.length === 0 || others.length === 0) {
    return [...scored].sort((a, b) => b.score - a.score);
  }

  const out: Scored[] = [];
  let pi = 0;
  let oi = 0;
  let togglePlace = true;

  while (out.length < MAX_RESULTS && (pi < places.length || oi < others.length)) {
    if (togglePlace && pi < places.length) {
      out.push(places[pi++]);
    } else if (!togglePlace && oi < others.length) {
      out.push(others[oi++]);
    } else if (pi < places.length) {
      out.push(places[pi++]);
    } else if (oi < others.length) {
      out.push(others[oi++]);
    }
    togglePlace = !togglePlace;
  }

  return out;
}

export function mergeGeocodeHits(
  query: string,
  hits: RawGeocodeHit[],
): GeocodeSuggestion[] {
  const scored: Scored[] = hits.map((hit) => {
    const suggestion = hitToSuggestion(hit);
    const score =
      textScore(query, hit) + kindBoost(suggestion.kind, query);
    return { hit, suggestion, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const deduped = dedupeHits(scored);
  const balanced = interleaveBalanced(deduped);
  return balanced.slice(0, MAX_RESULTS).map((s) => s.suggestion);
}

export async function searchGeocode(
  query: string,
  viewbox: Viewbox | null,
  fetchers: {
    nominatim: (q: string, v: Viewbox | null) => Promise<RawGeocodeHit[]>;
    photon: (q: string, v: Viewbox | null) => Promise<RawGeocodeHit[]>;
  },
): Promise<GeocodeSuggestion[]> {
  const [nomResult, photonResult] = await Promise.allSettled([
    fetchers.nominatim(query, viewbox),
    fetchers.photon(query, viewbox),
  ]);

  const hits: RawGeocodeHit[] = [];
  if (nomResult.status === "fulfilled") hits.push(...nomResult.value);
  if (photonResult.status === "fulfilled") hits.push(...photonResult.value);

  return mergeGeocodeHits(query, hits);
}
