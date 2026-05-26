import { jsonOk } from "@/lib/api-response";
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
  heading: string | null;
  landfallEta: string | null;
  bestTrack: StormPoint[];
  forecast: StormPoint[];
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
    return jsonOk({ storms: mapGeoJsonStorms(data) }, 600);
  } catch (e) {
    primaryError = (e as Error).message;
  }

  try {
    const xml = await fetchGdacsRssXml();
    const storms = parseRssStorms(xml);
    return jsonOk({ storms }, 600);
  } catch (fallbackError) {
    return jsonOk(
      {
        storms: [],
        _error: `${primaryError} | RSS fallback: ${(fallbackError as Error).message}`,
      },
      30,
    );
  }
}

function mapGeoJsonStorms(coll: GdacsCollection): Storm[] {
  const byEvent = new Map<string, GdacsFeature[]>();
  for (const f of coll.features ?? []) {
    const id = String(f.properties["eventid"] ?? f.properties["eventid_txt"] ?? "");
    if (!id) continue;
    const arr = byEvent.get(id) ?? [];
    arr.push(f);
    byEvent.set(id, arr);
  }

  const storms: Storm[] = [];
  for (const [id, feats] of byEvent) {
    const point = feats.find((f) => f.geometry.type === "Point");
    const line = feats.find((f) => f.geometry.type === "LineString");
    if (!point) continue;

    const props = point.properties;
    const coords = point.geometry.coordinates as [number, number];
    const bestTrack: StormPoint[] =
      line && line.geometry.type === "LineString"
        ? (line.geometry.coordinates as [number, number][]).map((position) => ({
            position,
          }))
        : [{ position: coords }];

    storms.push({
      id,
      name: String(props["eventname"] ?? props["name"] ?? "Unknown"),
      localName: coerceString(props["name_local"]),
      category: String(props["severity"] ?? "TD"),
      position: coords,
      windKph: Math.round(Number(props["wind_speed"] ?? 0)),
      pressureHpa: Math.round(Number(props["pressure"] ?? 0)),
      heading: coerceString(props["direction"]),
      landfallEta: coerceString(props["landfall"]),
      bestTrack,
      forecast: [],
    });
  }
  return storms;
}

// GDACS RSS only exposes the current point + severity per event, so the
// fallback produces a one-point best track and no forecast cone. Sufficient
// to keep the tracker populated when the JSON API is blocked.
function parseRssStorms(xml: string): Storm[] {
  const storms: Storm[] = [];
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
    const windKph = severityRaw ? Math.round(Number(severityRaw[1])) : 0;
    const severityText = severityRaw ? decodeEntities(severityRaw[2]).trim() : "";
    const link = firstRssMatch(block, /<link>([\s\S]*?)<\/link>/);
    const pubDate = firstRssMatch(block, /<pubDate>([\s\S]*?)<\/pubDate>/);

    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const position: [number, number] = [lng, lat];
    storms.push({
      id,
      name: name ?? "Unknown",
      localName: null,
      category: deriveCategory(alertLevel, severityText, windKph),
      position,
      windKph,
      pressureHpa: 0,
      heading: null,
      landfallEta: null,
      bestTrack: [{ position, time: pubDate, windKph }],
      forecast: [],
    });

    if (link) {
      storms[storms.length - 1].landfallEta = null;
    }
  }
  return storms;
}

function deriveCategory(
  alertLevel: string | undefined,
  severityText: string,
  windKph: number,
): string {
  if (/super|Cat[\s-]?5/i.test(severityText) || windKph >= 252) return "Super Typhoon";
  if (windKph >= 185) return "Typhoon";
  if (windKph >= 118) return "Severe Tropical Storm";
  if (windKph >= 89) return "Tropical Storm";
  if (windKph >= 62) return "Tropical Depression";
  return alertLevel ? `${alertLevel} alert` : "TD";
}

function coerceString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isGdacsCollection(value: unknown): value is GdacsCollection {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<GdacsCollection>;
  return payload.type === "FeatureCollection" && Array.isArray(payload.features);
}
