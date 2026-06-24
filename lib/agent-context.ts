/**
 * Server-side builder for the AGENT AERIS live context object.
 *
 * The returned object is JSON-stringified and passed to the LLM as a
 * dedicated system message. The dashboard already produces a rich
 * `NationalWeatherSnapshot` for the cron weather-report flow; we reuse
 * that to avoid duplicate data fetching.
 */

import { PH_REGIONS } from "@/config/region";
import { haversineKm, parseLatLonFromText } from "@/lib/geo";
import {
  fetchPagasaDailyWeather,
  type PagasaDaily,
  type PagasaDailyTc,
} from "@/lib/pagasa-daily";
import {
  fetchPagasaBulletins,
  type PagasaBulletins,
} from "@/lib/pagasa-bulletins";
import { fetchOpenMeteoForecast } from "@/lib/open-meteo-server";
import { computeForecastAlert } from "@/lib/forecast-alert";
import {
  buildNationalWeatherSnapshot,
  type NationalWeatherSnapshot,
} from "@/services/weather-snapshot";

export type AgentSelectedLocationHint = {
  name?: string;
  breadcrumb?: string;
  lat?: number;
  lon?: number;
  type?: string;
  psgcCode?: string;
  population?: number;
};

export type AgentContextLocation = {
  name: string;
  breadcrumb?: string;
  type?: string;
  lat?: number;
  lon?: number;
  nearestRegion?: { code: string; name: string; km: number };
  nearestTyphoon?: { name: string; km: number };
  /** 7-day Open-Meteo forecast at the pin (clipped). */
  localForecast?: {
    label: string;
    score: number;
    maxWindKph: number;
    peakDailyRainMm: number;
    minPressureHpa: number;
    totalRainMm: number;
  };
  /** Closest emergency/critical facilities from OSM within ~5 km. */
  nearbyFacilities?: AgentContextFacility[];
};

export type AgentContextFacility = {
  name: string;
  category: string;
  km: number;
};

export type AgentContextTyphoon = {
  title: string;
  summary: string;
  severity: string;
  issuedAt: string | null;
  coords?: { lat: number; lon: number };
};

export type AgentContextRiver = {
  name: string;
  level: string;
  current: number | null;
};

export type AgentLiveContext = {
  generatedAt: string;
  regionLock: "Philippines";
  /** Reminder for the LLM: verdictLabel is an AERIS composite, not PAGASA TCWS. */
  verdictDisclaimer: string;
  national: {
    verdictLabel: string;
    verdictTone: string;
    /** Plain-language drivers behind verdictLabel — surface these in briefs. */
    verdictReasons: string[];
    severityScore: number;
    briefFacts: string[];
    typhoonAlerts: AgentContextTyphoon[];
    /** Compact summary of the PAGASA "TC outside PAR" entry, when present. */
    tcOutsidePar: PagasaDailyTc | null;
    worstRegionalAlert: {
      label: string;
      level: number;
      score: number;
      tone: string;
    };
    elevatedRivers: AgentContextRiver[];
  };
  pagasaDaily: PagasaDaily | null;
  /**
   * Official PAGASA Tropical Cyclone Bulletins for systems inside PAR.
   * Index only (name / number / final / PDF link); wind signals live in the
   * linked PDFs. Null when unavailable; empty bulletins[] when no active TC.
   */
  pagasaBulletins: PagasaBulletins | null;
  selectedLocation: AgentContextLocation | null;
  freshness: {
    gdacs: string | null;
    openMeteo: string;
    waterLevels: string | null;
    pagasaDaily: string | null;
    pagasaBulletins: string | null;
    pagasaBulletinsIndexAgeSeconds: number | null;
    pagasaBulletinsStale: boolean;
    pagasaBulletinsWarning: string | null;
    snapshot: string;
  };
};

/** Single-flight + 60s memoization for the national snapshot. */
let snapshotCache: { at: number; value: NationalWeatherSnapshot } | null = null;
let snapshotInFlight: Promise<NationalWeatherSnapshot> | null = null;
const SNAPSHOT_TTL_MS = 60_000;

async function getCachedSnapshot(): Promise<NationalWeatherSnapshot> {
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return snapshotCache.value;
  }
  if (snapshotInFlight) return snapshotInFlight;

  snapshotInFlight = buildNationalWeatherSnapshot()
    .then((value) => {
      snapshotCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      snapshotInFlight = null;
    });
  return snapshotInFlight;
}

function pickNearestRegion(lat: number, lon: number) {
  let best: { code: string; name: string; km: number } | null = null;
  for (const region of PH_REGIONS) {
    const km = haversineKm(
      { lat, lon },
      { lat: region.center[1], lon: region.center[0] },
    );
    if (!best || km < best.km) {
      best = { code: region.code, name: region.name, km: Math.round(km) };
    }
  }
  return best ?? undefined;
}

function buildTyphoonEntries(
  snapshot: NationalWeatherSnapshot,
): AgentContextTyphoon[] {
  return snapshot.typhoonAlerts.slice(0, 3).map((tc) => {
    const coords =
      parseLatLonFromText(tc.summary) ?? parseLatLonFromText(tc.title);
    return {
      title: tc.title,
      summary: tc.summary,
      severity: tc.severity,
      issuedAt: tc.issuedAt,
      coords: coords ?? undefined,
    };
  });
}

function nearestTyphoonFor(
  lat: number,
  lon: number,
  typhoons: AgentContextTyphoon[],
) {
  let best: { name: string; km: number } | null = null;
  for (const tc of typhoons) {
    if (!tc.coords) continue;
    const km = haversineKm({ lat, lon }, tc.coords);
    if (!best || km < best.km) {
      best = { name: tc.title, km: Math.round(km) };
    }
  }
  return best ?? undefined;
}

export async function buildAgentLiveContext(
  selectedHint: AgentSelectedLocationHint | null,
): Promise<AgentLiveContext> {
  const [snapshot, pagasaDaily, pagasaBulletins] = await Promise.all([
    getCachedSnapshot(),
    fetchPagasaDailyWeather().catch(() => null),
    fetchPagasaBulletins().catch(() => null),
  ]);

  const typhoons = buildTyphoonEntries(snapshot);

  let selectedLocation: AgentContextLocation | null = null;
  if (selectedHint && selectedHint.name) {
    const lat =
      typeof selectedHint.lat === "number" ? selectedHint.lat : undefined;
    const lon =
      typeof selectedHint.lon === "number" ? selectedHint.lon : undefined;
    const hasCoords = typeof lat === "number" && typeof lon === "number";

    let localForecast: AgentContextLocation["localForecast"] | undefined;
    let nearbyFacilities: AgentContextFacility[] | undefined;
    if (hasCoords) {
      const [forecast, facilities] = await Promise.all([
        fetchOpenMeteoForecast([lon!, lat!]).catch(() => null),
        fetchNearbyFacilities(lat!, lon!).catch(() => undefined),
      ]);
      if (forecast) {
        const alert = computeForecastAlert(forecast);
        const peakDailyRainMm = Math.max(
          ...forecast.daily.map((d) => d.rainMm),
          0,
        );
        localForecast = {
          label: alert.label,
          score: alert.score,
          maxWindKph: Math.round(forecast.maxWindKph),
          peakDailyRainMm: Number(peakDailyRainMm.toFixed(1)),
          minPressureHpa: Math.round(forecast.minPressureHpa),
          totalRainMm: Number(forecast.totalRainMm.toFixed(1)),
        };
      }
      if (facilities && facilities.length > 0) {
        nearbyFacilities = facilities;
      }
    }

    selectedLocation = {
      name: selectedHint.name,
      breadcrumb: selectedHint.breadcrumb,
      type: selectedHint.type,
      lat: hasCoords ? Number(lat!.toFixed(4)) : undefined,
      lon: hasCoords ? Number(lon!.toFixed(4)) : undefined,
      nearestRegion: hasCoords ? pickNearestRegion(lat!, lon!) : undefined,
      nearestTyphoon: hasCoords
        ? nearestTyphoonFor(lat!, lon!, typhoons)
        : undefined,
      localForecast,
      nearbyFacilities,
    };
  }

  return {
    generatedAt: snapshot.generatedAt,
    regionLock: "Philippines",
    verdictDisclaimer:
      "verdictLabel is an AERIS composite (forecast + GDACS + rivers + TC count). It is NOT a PAGASA wind signal. Never say 'Signal No.' unless that exact wording appears in pagasaDaily.",
    national: {
      verdictLabel: snapshot.verdict.label,
      verdictTone: snapshot.verdict.tone,
      verdictReasons: snapshot.verdict.reasons.slice(0, 4),
      severityScore: snapshot.severityScore,
      briefFacts: snapshot.briefFacts.slice(0, 6),
      typhoonAlerts: typhoons,
      tcOutsidePar: pagasaDaily?.tcOutsidePar ?? null,
      worstRegionalAlert: {
        label: snapshot.worstRegionalAlert.label,
        level: snapshot.worstRegionalAlert.level,
        score: snapshot.worstRegionalAlert.score,
        tone: snapshot.worstRegionalAlert.tone,
      },
      elevatedRivers: snapshot.waterLevels.elevated.slice(0, 3).map((s) => ({
        name: s.name,
        level: s.level,
        current: s.current ?? null,
      })),
    },
    pagasaDaily,
    pagasaBulletins,
    selectedLocation,
    freshness: {
      gdacs: snapshot.sourcesFreshness.gdacs,
      openMeteo: snapshot.sourcesFreshness.openMeteo,
      waterLevels: snapshot.sourcesFreshness.waterLevels,
      pagasaDaily: pagasaDaily?.fetchedAt ?? null,
      pagasaBulletins: pagasaBulletins?.fetchedAt ?? null,
      pagasaBulletinsIndexAgeSeconds: pagasaBulletins?.indexAgeSeconds ?? null,
      pagasaBulletinsStale: pagasaBulletins?.stale === true,
      pagasaBulletinsWarning: pagasaBulletins?.warning ?? null,
      snapshot: snapshot.generatedAt,
    },
  };
}

const FACILITY_BBOX_DEG = 0.045; // ~5 km at PH latitudes
const FACILITY_PRIORITY_CATEGORIES = new Set([
  "hospital",
  "evacuation",
  "fire_station",
  "police",
]);

/** Server-side helper: hits our own /api/osm-context with a tight bbox around
 *  the selected pin and projects the top priority facilities by distance. */
async function fetchNearbyFacilities(
  lat: number,
  lon: number,
): Promise<AgentContextFacility[] | undefined> {
  const base = process.env.AERIS_INTERNAL_BASE_URL?.replace(/\/$/, "");
  const origin =
    base ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3001";

  const west = lon - FACILITY_BBOX_DEG;
  const east = lon + FACILITY_BBOX_DEG;
  const south = lat - FACILITY_BBOX_DEG;
  const north = lat + FACILITY_BBOX_DEG;
  const bbox = [west, south, east, north]
    .map((v) => v.toFixed(4))
    .join(",");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(
      `${origin}/api/osm-context?bbox=${bbox}&zoom=13`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!res.ok) return undefined;
    const payload = (await res.json()) as {
      facilities?: {
        features?: Array<{
          geometry?: { type?: string; coordinates?: [number, number] };
          properties?: { name?: string; category?: string };
        }>;
      };
    };
    const features = payload.facilities?.features ?? [];
    const ranked: AgentContextFacility[] = [];
    for (const feature of features) {
      const coords = feature.geometry?.coordinates;
      const category = feature.properties?.category ?? "government";
      if (!Array.isArray(coords) || coords.length < 2) continue;
      if (!FACILITY_PRIORITY_CATEGORIES.has(category)) continue;
      const km = haversineKm(
        { lat, lon },
        { lat: coords[1], lon: coords[0] },
      );
      ranked.push({
        name: feature.properties?.name?.trim() || categoryLabel(category),
        category,
        km: Number(km.toFixed(1)),
      });
    }
    ranked.sort((a, b) => a.km - b.km);
    return ranked.slice(0, 5);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function categoryLabel(category: string): string {
  switch (category) {
    case "hospital":
      return "Hospital";
    case "evacuation":
      return "Evacuation site";
    case "fire_station":
      return "Fire station";
    case "police":
      return "Police";
    default:
      return "Facility";
  }
}
