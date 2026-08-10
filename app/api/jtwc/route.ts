import { jsonOk } from "@/lib/api-response";
import { parseLatLonFromText } from "@/lib/geo";
import {
  categoryFromGdacsProps,
  deriveTcCategory,
  gustKphFromWind,
  headingFromTrack,
  isInParBbox,
  isInWestpacMonitorZone,
  pressureHpaFromGdacsProps,
  windKphFromGdacsProps,
  windKphFromRssSeverity,
} from "@/lib/gdacs-tc";
import {
  fetchPagasaDailyWeather,
  parseKmhFromPagasaField,
  type PagasaDailyTc,
} from "@/lib/pagasa-daily";
import { fetchUpstream } from "@/lib/fetch-upstream";
import {
  decodeEntities,
  fetchGdacsRssXml,
  firstRssMatch,
} from "@/lib/gdacs-rss";
import {
  fetchJmaStorms,
  typhoonNumberFromText,
  type JmaStorm,
} from "@/lib/jma-typhoon";
import { assessOutsideParThreat } from "@/lib/tc-threat";

export const runtime = "nodejs";
export const revalidate = 600;

// Legacy route name; data comes from the GDACS tropical cyclone feed
// (primary JSON API, with XML RSS as a resilient fallback).

type StormPoint = {
  position: [number, number];
  time?: string | null;
  windKph?: number | null;
  pressureHpa?: number;
  /** Hours ahead of analysis, for forecast points. */
  hoursAhead?: number;
  /** JMA 70% position-probability circle, km — reported, not derived. */
  probabilityRadiusKm?: number | null;
  /** Reported wind radii, km — lights up the map's real rings layer. */
  radiusKm?: { kt60?: number; kt30?: number; kt15?: number };
};

type Storm = {
  id: string;
  name: string;
  localName: string | null;
  category: string;
  position: [number, number];
  windKph: number;
  pressureHpa: number;
  gustKph: number | null;
  heading: string | null;
  landfallEta: string | null;
  bestTrack: StormPoint[];
  forecast: StormPoint[];
  /** Four-digit basin storm number when known (JMA); PAGASA prints it too. */
  typhoonNumber?: string;
  /** Distance (km) to PAR — only set for outside-PAR monitor systems. */
  distanceToParKm?: number;
  /** Whether an outside-PAR system is tracking toward PAR. */
  approachingPar?: boolean;
};

type OutsideParAdvisory = {
  source: "pagasa";
  name: string;
  location: string;
  maxWindsKmh?: string;
  gustinessKmh?: string;
  movement?: string;
  issuedAt: string | null;
  windKph: number | null;
  position: [number, number] | null;
  /**
   * Id of the tracked storm covering the same system, when one exists. The
   * panel keeps the PAGASA card but renders the storm on the map instead of
   * the advisory's single point — real track and forecast beat a parsed
   * location string.
   */
  coveredByStormId?: string | null;
};

type JtwcPayload = {
  storms: Storm[];
  outsidePar: OutsideParAdvisory | null;
  outsideParGdacs: Storm[];
};

type GdacsFeature = {
  type: "Feature";
  geometry: {
    type: "LineString" | "Point" | "Polygon" | "MultiLineString";
    coordinates: unknown;
  };
  properties: Record<string, unknown>;
};

type GdacsCollection = {
  type: "FeatureCollection";
  features: GdacsFeature[];
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function GET() {
  // JMA runs alongside GDACS, not behind it: GDACS has been unreachable from
  // this deployment region for stretches ("GDACS: fetch failed" in the alerts
  // panel), and JMA — the WMO forecast authority for this basin — carries the
  // real tracks, forecasts, and wind radii regardless.
  const [pagasaOutsidePar, jmaStorms] = await Promise.all([
    buildPagasaOutsideParAdvisory(),
    fetchJmaStorms(),
  ]);

  let split: { storms: Storm[]; outsideParGdacs: Storm[] } | null = null;
  let primaryError: string | null = null;
  let fallbackError: string | null = null;

  try {
    const url =
      "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC";
    const res = await fetchUpstream(url, {
      next: { revalidate: 600 },
      headers: {
        accept: "application/json,text/plain,*/*",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": BROWSER_UA,
      },
    });
    if (!res.ok) throw new Error(`GDACS ${res.status} at ${url}`);
    const payload = (await res.json()) as unknown;
    if (!isGdacsCollection(payload)) {
      throw new Error("GDACS returned an invalid tropical cyclone payload.");
    }
    split = mapGeoJsonStorms(payload);
  } catch (e) {
    primaryError = (e as Error).message;
  }

  if (!split) {
    try {
      split = parseRssStorms(await fetchGdacsRssXml());
    } catch (e) {
      fallbackError = (e as Error).message;
      split = { storms: [], outsideParGdacs: [] };
    }
  }

  mergeJmaStorms(split, jmaStorms, pagasaOutsidePar);
  const payload = finalizeJtwcPayload(split, pagasaOutsidePar);

  if (fallbackError) {
    // GDACS fully down. With JMA storms flowing this is a degraded-source
    // note, not an outage — cache normally so the tracker stays stable.
    const hasStorms =
      payload.storms.length > 0 || payload.outsideParGdacs.length > 0;
    return jsonOk(
      {
        ...payload,
        _error: `${primaryError} | RSS fallback: ${fallbackError}`,
      },
      hasStorms ? 600 : 30,
    );
  }

  return jsonOk(payload, 600);
}

/** True when the tracked storm and the PAGASA advisory are the same system. */
function stormMatchesAdvisory(storm: Storm, advisory: OutsideParAdvisory): boolean {
  const advisoryNumber = typhoonNumberFromText(advisory.name);
  if (advisoryNumber && storm.typhoonNumber === advisoryNumber) return true;
  // Name heuristic for GDACS storms (no number): GDACS names run "PEILOU-26",
  // PAGASA runs "TROPICAL STORM PEILOU (2616)" — compare on the letter stem.
  const stem = storm.name.toUpperCase().replace(/[^A-Z].*$/, "");
  return stem.length >= 3 && advisory.name.toUpperCase().includes(stem);
}

function jmaTrackPoints(jma: JmaStorm): StormPoint[] {
  const points: StormPoint[] = jma.track.map((position) => ({ position }));
  const last = points[points.length - 1];
  if (last && jma.galeRadiusKm) {
    // The renderer's rings layer reads radii off the final best-track point.
    // This is a *reported* radius (JMA gale-warning sector max), which also
    // tells the renderer to drop the climatological wind-field estimate.
    last.radiusKm = { kt30: jma.galeRadiusKm };
  }
  return points;
}

function jmaForecastPoints(jma: JmaStorm): StormPoint[] {
  return jma.forecast.map((p) => ({
    position: p.position,
    time: p.validTimeUtc,
    windKph: p.windKph,
    hoursAhead: p.hoursAhead,
    probabilityRadiusKm: p.probabilityRadiusKm,
  }));
}

/** Overwrite a GDACS storm's guesses with JMA's reported values. */
function enrichStormFromJma(storm: Storm, jma: JmaStorm): void {
  storm.position = jma.position;
  storm.category = jma.category;
  if (jma.windKph > 0) storm.windKph = jma.windKph;
  if (jma.gustKph) storm.gustKph = jma.gustKph;
  if (jma.pressureHpa > 0) storm.pressureHpa = jma.pressureHpa;
  if (jma.heading) storm.heading = jma.heading;
  storm.typhoonNumber = jma.typhoonNumber;
  storm.bestTrack = jmaTrackPoints(jma);
  storm.forecast = jmaForecastPoints(jma);
}

function jmaToStorm(jma: JmaStorm): Storm {
  return {
    id: `jma-${jma.tcId}`,
    name: jma.name.toUpperCase(),
    localName: null,
    category: jma.category,
    position: jma.position,
    windKph: jma.windKph,
    pressureHpa: jma.pressureHpa,
    gustKph: jma.gustKph ?? gustKphFromWind(jma.windKph),
    heading: jma.heading,
    landfallEta: null,
    bestTrack: jmaTrackPoints(jma),
    forecast: jmaForecastPoints(jma),
    typhoonNumber: jma.typhoonNumber,
  };
}

/**
 * Fold JMA's catalogue into the GDACS buckets. A storm GDACS already tracks
 * gets enriched in place (same id, so the map re-renders seamlessly); new
 * storms are bucketed by position. A storm matching the PAGASA advisory is
 * always kept as a monitor — PAGASA flagging it is the relevance judgment,
 * and its real track should replace the advisory's dead-reckoned point.
 */
function mergeJmaStorms(
  split: { storms: Storm[]; outsideParGdacs: Storm[] },
  jmaStorms: JmaStorm[],
  advisory: OutsideParAdvisory | null,
): void {
  for (const jma of jmaStorms) {
    const jmaName = jma.name.toUpperCase();
    const existing =
      split.storms.find((s) => s.name.toUpperCase().includes(jmaName)) ??
      split.outsideParGdacs.find((s) => s.name.toUpperCase().includes(jmaName));
    if (existing) {
      enrichStormFromJma(existing, jma);
      continue;
    }

    const storm = jmaToStorm(jma);
    if (isInParBbox(storm.position[0], storm.position[1])) {
      split.storms.push(storm);
      continue;
    }

    if (advisory && stormMatchesAdvisory(storm, advisory)) {
      const threat = assessOutsideParThreat({
        position: storm.position,
        track: storm.bestTrack.map((p) => p.position),
        heading: storm.heading,
      });
      storm.distanceToParKm = threat.distanceToParKm;
      storm.approachingPar = threat.approachingPar;
      split.outsideParGdacs.push(storm);
      continue;
    }

    maybePushOutsideParMonitor(storm, split.outsideParGdacs);
  }
}

async function buildPagasaOutsideParAdvisory(): Promise<OutsideParAdvisory | null> {
  const daily = await fetchPagasaDailyWeather();
  const tc = daily?.tcOutsidePar;
  if (!tc) return null;
  return pagasaTcToOutsideParAdvisory(tc, daily.issuedAt);
}

function pagasaTcToOutsideParAdvisory(
  tc: PagasaDailyTc,
  issuedAt: string | null,
): OutsideParAdvisory {
  const coords = parseLatLonFromText(tc.location);
  return {
    source: "pagasa",
    name: tc.name,
    location: tc.location,
    maxWindsKmh: tc.maxWindsKmh,
    gustinessKmh: tc.gustinessKmh,
    movement: tc.movement,
    issuedAt,
    windKph: parseKmhFromPagasaField(tc.maxWindsKmh),
    position: coords ? [coords.lon, coords.lat] : null,
  };
}

function finalizeJtwcPayload(
  split: { storms: Storm[]; outsideParGdacs: Storm[] },
  pagasaOutsidePar: OutsideParAdvisory | null,
): JtwcPayload {
  const monitors = [...split.outsideParGdacs].sort(
    (a, b) => (a.distanceToParKm ?? Infinity) - (b.distanceToParKm ?? Infinity),
  );

  // Previously the advisory suppressed the whole monitor list to avoid showing
  // the same storm twice. Now the storm and the advisory are *linked* instead:
  // the panel keeps the PAGASA card and renders the tracked storm on the map
  // (real track and forecast beat a position parsed out of advisory prose).
  let outsidePar = pagasaOutsidePar;
  if (outsidePar) {
    const covering =
      monitors.find((s) => stormMatchesAdvisory(s, outsidePar!)) ??
      split.storms.find((s) => stormMatchesAdvisory(s, outsidePar!)) ??
      null;
    outsidePar = { ...outsidePar, coveredByStormId: covering?.id ?? null };
  }

  return {
    storms: split.storms,
    outsidePar,
    outsideParGdacs: monitors,
  };
}

function mapGeoJsonStorms(coll: GdacsCollection): {
  storms: Storm[];
  outsideParGdacs: Storm[];
} {
  const byEvent = new Map<string, GdacsFeature[]>();
  for (const f of coll.features ?? []) {
    const id = String(f.properties["eventid"] ?? f.properties["eventid_txt"] ?? "");
    if (!id) continue;
    const arr = byEvent.get(id) ?? [];
    arr.push(f);
    byEvent.set(id, arr);
  }

  const storms: Storm[] = [];
  const outsideParGdacs: Storm[] = [];
  for (const [id, feats] of byEvent) {
    const storm = buildStormFromGdacsFeatures(id, feats);
    if (!storm) continue;
    if (isInParBbox(storm.position[0], storm.position[1])) {
      storms.push(storm);
    } else {
      maybePushOutsideParMonitor(storm, outsideParGdacs);
    }
  }
  return { storms, outsideParGdacs };
}

/**
 * Add an outside-PAR system to the monitor list only when it's a real threat:
 * inside the WestPac watch zone and either near PAR or tracking toward it.
 * Annotates the storm with its PAR distance and approach flag for the UI.
 */
function maybePushOutsideParMonitor(storm: Storm, out: Storm[]): void {
  const [lng, lat] = storm.position;
  if (!isInWestpacMonitorZone(lng, lat)) return;

  const threat = assessOutsideParThreat({
    position: storm.position,
    track: storm.bestTrack.map((p) => p.position),
    heading: storm.heading,
  });
  if (!threat.relevant) return;

  storm.distanceToParKm = threat.distanceToParKm;
  storm.approachingPar = threat.approachingPar;
  out.push(storm);
}

function buildStormFromGdacsFeatures(
  id: string,
  feats: GdacsFeature[],
): Storm | null {
  const point = feats.find((f) => f.geometry.type === "Point");
  const line = feats.find((f) => f.geometry.type === "LineString");
  if (!point) return null;

  const props = point.properties;
  const coords = point.geometry.coordinates as [number, number];
  const windKph = windKphFromGdacsProps(props);
  const bestTrack: StormPoint[] =
    line && line.geometry.type === "LineString"
      ? (line.geometry.coordinates as [number, number][]).map((position) => ({
          position,
        }))
      : [{ position: coords }];

  return {
    id,
    name: String(props["eventname"] ?? props["name"] ?? "Unknown"),
    localName: coerceString(props["name_local"]),
    category: categoryFromGdacsProps(props, windKph),
    position: coords,
    windKph,
    pressureHpa: pressureHpaFromGdacsProps(props),
    gustKph: gustKphFromWind(windKph),
    heading:
      coerceString(props["direction"]) ??
      headingFromTrack(bestTrack.map((p) => p.position)),
    landfallEta: coerceString(props["landfall"]),
    bestTrack,
    forecast: [],
  };
}

// GDACS RSS only exposes the current point + severity per event, so the
// fallback produces a one-point best track and no forecast cone. Sufficient
// to keep the tracker populated when the JSON API is blocked.
function parseRssStorms(xml: string): { storms: Storm[]; outsideParGdacs: Storm[] } {
  const storms: Storm[] = [];
  const outsideParGdacs: Storm[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of blocks) {
    if (!/<gdacs:eventtype>TC<\/gdacs:eventtype>/.test(block)) continue;
    if (!/<gdacs:iscurrent>true<\/gdacs:iscurrent>/.test(block)) continue;

    const id = firstRssMatch(block, /<gdacs:eventid>([\s\S]*?)<\/gdacs:eventid>/);
    const name = firstRssMatch(block, /<gdacs:eventname>([\s\S]*?)<\/gdacs:eventname>/);
    const alertLevel = firstRssMatch(block, /<gdacs:alertlevel>([\s\S]*?)<\/gdacs:alertlevel>/);
    const lat = Number(firstRssMatch(block, /<geo:lat>([\s\S]*?)<\/geo:lat>/));
    const lng = Number(firstRssMatch(block, /<geo:long>([\s\S]*?)<\/geo:long>/));
    const severityRaw = block.match(
      /<gdacs:severity[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/gdacs:severity>/,
    );
    const severityText = severityRaw ? decodeEntities(severityRaw[2]).trim() : "";
    const windKph = severityRaw
      ? windKphFromRssSeverity(severityRaw[1], severityText)
      : 0;
    const link = firstRssMatch(block, /<link>([\s\S]*?)<\/link>/);
    const pubDate = firstRssMatch(block, /<pubDate>([\s\S]*?)<\/pubDate>/);

    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const position: [number, number] = [lng, lat];
    const storm: Storm = {
      id,
      name: name ?? "Unknown",
      localName: null,
      category: deriveTcCategory(alertLevel, severityText, windKph),
      position,
      windKph,
      pressureHpa: 0,
      gustKph: gustKphFromWind(windKph),
      heading: null,
      landfallEta: null,
      bestTrack: [{ position, time: pubDate, windKph }],
      forecast: [],
    };

    if (isInParBbox(lng, lat)) {
      storms.push(storm);
    } else {
      maybePushOutsideParMonitor(storm, outsideParGdacs);
    }
  }
  return { storms, outsideParGdacs };
}

function coerceString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isGdacsCollection(value: unknown): value is GdacsCollection {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<GdacsCollection>;
  return payload.type === "FeatureCollection" && Array.isArray(payload.features);
}
