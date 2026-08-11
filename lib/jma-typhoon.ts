/**
 * JMA (Japan Meteorological Agency) tropical cyclone data.
 *
 * JMA is the WMO's Regional Specialized Meteorological Center for the Western
 * North Pacific — the official forecast authority for this basin. Its bosai
 * JSON feeds carry what neither GDACS nor the PAGASA daily advisory does:
 *
 *   forecast.json        the full observed track, plus forecast centers at
 *                        +12/+24/+45… hours, each with an official
 *                        probability circle (70% position uncertainty)
 *   specifications.json  sustained/gust winds, pressure, course and speed,
 *                        and actual gale-wind radii by sector
 *
 * That upgrades the map from dead-reckoned rays and climatological wind-field
 * estimates to reported forecasts and reported radii wherever a storm is in
 * JMA's catalogue. It also de-risks the GDACS dependency: GDACS has been
 * unreachable ("fetch failed" in the alerts panel) from both dev and the
 * production region, and with this module real storms keep flowing without it.
 *
 * Gotchas encoded here so they cannot be re-learned the hard way:
 *   - JMA coordinates are [lat, lng]; ours are [lng, lat]. Flipped on parse.
 *   - probabilityCircle.radius and galeWarningArea.radius are METERS.
 *   - galeWarning ranges in specifications are KILOMETERS.
 *   - course is a Japanese 16-point compass word (北東 = NE).
 */

import type { LngLat } from "@/config/region";
import { fetchUpstream } from "@/lib/fetch-upstream";

const JMA_BASE = "https://www.jma.go.jp/bosai/typhoon/data";
const KT_TO_KPH = 1.852;

export type JmaForecastPoint = {
  position: LngLat;
  hoursAhead: number;
  validTimeUtc: string | null;
  /** Official 70% position-probability circle, km. */
  probabilityRadiusKm: number | null;
  windKph: number | null;
};

export type JmaStorm = {
  tcId: string;
  /** Four-digit storm number, e.g. "2616" — PAGASA prints this in its names. */
  typhoonNumber: string;
  name: string;
  category: string;
  position: LngLat;
  windKph: number;
  gustKph: number | null;
  pressureHpa: number;
  heading: string | null;
  speedKph: number | null;
  /** Observed track (analysis), oldest first, ending at `position`. */
  track: LngLat[];
  forecast: JmaForecastPoint[];
  /** Largest reported gale-force (≥30 kt) sector radius, km. */
  galeRadiusKm: number | null;
  issuedAtUtc: string | null;
};

/** Japanese 16-point compass → international code. */
const JP_COMPASS: Record<string, string> = {
  北: "N",
  北北東: "NNE",
  北東: "NE",
  東北東: "ENE",
  東: "E",
  東南東: "ESE",
  南東: "SE",
  南南東: "SSE",
  南: "S",
  南南西: "SSW",
  南西: "SW",
  西南西: "WSW",
  西: "W",
  西北西: "WNW",
  北西: "NW",
  北北西: "NNW",
};

export function jpCourseToCompass(course: string | null | undefined): string | null {
  if (!course) return null;
  return JP_COMPASS[course.trim()] ?? null;
}

const CATEGORY_LABEL: Record<string, string> = {
  TD: "Tropical Depression",
  TS: "Tropical Storm",
  STS: "Severe Tropical Storm",
  TY: "Typhoon",
};

/** "TROPICAL STORM PEILOU (2616)" → "2616". */
export function typhoonNumberFromText(text: string | null | undefined): string | null {
  const match = text?.match(/\((\d{4})\)/);
  return match ? match[1] : null;
}

type JmaPart = Record<string, unknown> & {
  part?: unknown;
  advancedHours?: unknown;
};

function asParts(payload: unknown): JmaPart[] {
  return Array.isArray(payload) ? (payload as JmaPart[]) : [];
}

/** JMA [lat, lng] pair → our [lng, lat]; null for anything malformed. */
function flipLatLng(pair: unknown): LngLat | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const [lat, lng] = pair as [unknown, unknown];
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ktToKph(kt: unknown): number | null {
  const n = toNumber(kt);
  return n && n > 0 ? Math.round(n * KT_TO_KPH) : null;
}

/**
 * Parse one storm from its two bosai files. Pure so the fixture tests can
 * exercise it; returns null when the payload lacks the analysis essentials.
 */
export function parseJmaStorm(
  tcId: string,
  forecastPayload: unknown,
  specPayload: unknown,
): JmaStorm | null {
  const forecastParts = asParts(forecastPayload);
  const specParts = asParts(specPayload);

  const title = specParts.find((p) => p.part === "title") ??
    forecastParts.find((p) => p.part === "title");
  const analysisTrack = forecastParts.find((p) => p.advancedHours === 0);
  const analysisSpec = specParts.find((p) => p.advancedHours === 0);
  if (!title || !analysisTrack || !analysisSpec) return null;

  const position =
    flipLatLng(analysisTrack.center) ??
    flipLatLng((analysisSpec.position as Record<string, unknown> | undefined)?.deg);
  if (!position) return null;

  const name = (title.name as Record<string, unknown> | undefined)?.en;
  const typhoonNumber = title.typhoonNumber;
  if (typeof name !== "string" || typeof typhoonNumber !== "string") return null;

  // Observed track: preTyphoon + typhoon phases share their junction point;
  // consecutive duplicates are collapsed. The track must end at the current
  // center so the rings/windfield anchor is the analysis position.
  const trackRaw = (analysisTrack.track ?? {}) as Record<string, unknown>;
  const track: LngLat[] = [];
  for (const phase of ["preTyphoon", "typhoon"]) {
    for (const pair of Array.isArray(trackRaw[phase]) ? (trackRaw[phase] as unknown[]) : []) {
      const p = flipLatLng(pair);
      if (!p) continue;
      const last = track[track.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      track.push(p);
    }
  }
  const last = track[track.length - 1];
  if (!last || last[0] !== position[0] || last[1] !== position[1]) {
    track.push(position);
  }

  // Wind per forecast hour lives in specifications; positions in forecast.
  const windByHour = new Map<number, number | null>();
  for (const part of specParts) {
    const hours = toNumber(part.advancedHours);
    if (hours === null) continue;
    const wind = (part.maximumWind as Record<string, unknown> | undefined)?.sustained as
      | Record<string, unknown>
      | undefined;
    windByHour.set(hours, ktToKph(wind?.kt));
  }

  const forecast: JmaForecastPoint[] = [];
  for (const part of forecastParts) {
    const hours = toNumber(part.advancedHours);
    if (hours === null || hours <= 0) continue;
    const center = flipLatLng(part.center);
    if (!center) continue;
    const radiusM = toNumber(
      (part.probabilityCircle as Record<string, unknown> | undefined)?.radius,
    );
    const validtime = part.validtime as Record<string, unknown> | undefined;
    forecast.push({
      position: center,
      hoursAhead: hours,
      validTimeUtc: typeof validtime?.UTC === "string" ? validtime.UTC : null,
      probabilityRadiusKm: radiusM !== null ? Math.round(radiusM / 1000) : null,
      windKph: windByHour.get(hours) ?? null,
    });
  }
  forecast.sort((a, b) => a.hoursAhead - b.hoursAhead);

  const sustained = (analysisSpec.maximumWind as Record<string, unknown> | undefined)
    ?.sustained as Record<string, unknown> | undefined;
  const gust = (analysisSpec.maximumWind as Record<string, unknown> | undefined)?.gust as
    | Record<string, unknown>
    | undefined;

  let galeRadiusKm: number | null = null;
  for (const sector of Array.isArray(analysisSpec.galeWarning)
    ? (analysisSpec.galeWarning as Array<Record<string, unknown>>)
    : []) {
    const km = toNumber((sector.range as Record<string, unknown> | undefined)?.km);
    if (km !== null && (galeRadiusKm === null || km > galeRadiusKm)) galeRadiusKm = km;
  }

  const categoryEn = (title.category as Record<string, unknown> | undefined)?.en;
  const issue = (title.issue as Record<string, unknown> | undefined)?.UTC;

  return {
    tcId,
    typhoonNumber,
    name,
    category:
      typeof categoryEn === "string"
        ? (CATEGORY_LABEL[categoryEn] ?? categoryEn)
        : "Tropical Cyclone",
    position,
    windKph: ktToKph(sustained?.kt) ?? 0,
    gustKph: ktToKph(gust?.kt),
    pressureHpa: toNumber(analysisSpec.pressure) ?? 0,
    heading: jpCourseToCompass(
      typeof analysisSpec.course === "string" ? analysisSpec.course : null,
    ),
    speedKph: toNumber((analysisSpec.speed as Record<string, unknown> | undefined)?.["km/h"]),
    track,
    forecast,
    galeRadiusKm,
    issuedAtUtc: typeof issue === "string" ? issue : null,
  };
}

type TargetTcEntry = { tropicalCyclone?: unknown };

/**
 * Fetch every storm in JMA's current catalogue. Per-storm failures are
 * swallowed (one bad file must not drop the rest); a total failure returns []
 * so /api/jtwc degrades to its existing sources.
 */
export async function fetchJmaStorms(): Promise<JmaStorm[]> {
  let ids: string[] = [];
  try {
    const res = await fetchUpstream(`${JMA_BASE}/targetTc.json`, {
      next: { revalidate: 600 },
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`JMA targetTc ${res.status}`);
    const entries = (await res.json()) as TargetTcEntry[];
    ids = (Array.isArray(entries) ? entries : [])
      .map((e) => e.tropicalCyclone)
      .filter((id): id is string => typeof id === "string" && /^TC\d+$/.test(id));
  } catch (error) {
    console.warn(`[jma] catalogue fetch failed: ${(error as Error).message}`);
    return [];
  }

  const storms = await Promise.all(
    ids.map(async (tcId) => {
      try {
        const [forecastRes, specRes] = await Promise.all([
          fetchUpstream(`${JMA_BASE}/${tcId}/forecast.json`, {
            next: { revalidate: 600 },
            headers: { accept: "application/json" },
          }),
          fetchUpstream(`${JMA_BASE}/${tcId}/specifications.json`, {
            next: { revalidate: 600 },
            headers: { accept: "application/json" },
          }),
        ]);
        if (!forecastRes.ok || !specRes.ok) {
          throw new Error(`forecast ${forecastRes.status} / spec ${specRes.status}`);
        }
        return parseJmaStorm(tcId, await forecastRes.json(), await specRes.json());
      } catch (error) {
        console.warn(`[jma] ${tcId} fetch failed: ${(error as Error).message}`);
        return null;
      }
    }),
  );

  return storms.filter((s): s is JmaStorm => s !== null);
}
