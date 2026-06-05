import { jsonOk } from "@/lib/api-response";
import { parseLatLonFromText } from "@/lib/geo";
import {
  categoryFromGdacsProps,
  deriveTcCategory,
  gustKphFromWind,
  headingFromTrack,
  isInParBbox,
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

export const runtime = "nodejs";
export const revalidate = 600;

// Legacy route name; data comes from the GDACS tropical cyclone feed
// (primary JSON API, with XML RSS as a resilient fallback).

type StormPoint = {
  position: [number, number];
  time?: string;
  windKph?: number;
  pressureHpa?: number;
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
  const pagasaOutsidePar = await buildPagasaOutsideParAdvisory();
  let primaryError: string | null = null;
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
    const data = payload;
    return jsonOk(
      finalizeJtwcPayload(mapGeoJsonStorms(data), pagasaOutsidePar),
      600,
    );
  } catch (e) {
    primaryError = (e as Error).message;
  }

  try {
    const xml = await fetchGdacsRssXml();
    const split = parseRssStorms(xml);
    return jsonOk(
      finalizeJtwcPayload(split, pagasaOutsidePar),
      600,
    );
  } catch (fallbackError) {
    return jsonOk(
      {
        ...finalizeJtwcPayload({ storms: [], outsideParGdacs: [] }, pagasaOutsidePar),
        _error: `${primaryError} | RSS fallback: ${(fallbackError as Error).message}`,
      },
      30,
    );
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
  return {
    storms: split.storms,
    outsidePar: pagasaOutsidePar,
    outsideParGdacs: pagasaOutsidePar ? [] : split.outsideParGdacs,
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
      outsideParGdacs.push(storm);
    }
  }
  return { storms, outsideParGdacs };
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
      outsideParGdacs.push(storm);
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
