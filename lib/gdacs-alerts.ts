import { PAR_BBOX } from "@/config/region";
import { filterSubstantiveAlerts } from "@/lib/alert-quality";
import {
  fetchGdacsRssXml,
  firstRssMatch,
  stripHtml,
} from "@/lib/gdacs-rss";

export type GdacsAlert = {
  id: string;
  source: "GDACS";
  severity: "info" | "watch" | "warning" | "emergency";
  title: string;
  summary: string;
  issuedAt: string | null;
  url?: string;
};

const PH_RE =
  /philippines|luzon|visayas|mindanao|philippine\s+sea|filipino|par\b|phl\b|metro\s+manila|manila|cebu|davao|palawan|leyte|samar|bicol|caraga|iloc/i;

const GDACS_IS_CURRENT = /<gdacs:iscurrent>true<\/gdacs:iscurrent>/;

/** Drop ended GDACS hazard rows that linger in RSS with old pubDates. */
export const HAZARD_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/** One GDACS RSS fetch → active TC in PAR + PH-relevant hazard bulletins. */
export async function buildAlertsFromGdacsRss(): Promise<GdacsAlert[]> {
  const xml = await fetchGdacsRssXml();
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const [minLng, minLat, maxLng, maxLat] = PAR_BBOX;

  const tcAlerts: GdacsAlert[] = [];
  const hazardAlerts: GdacsAlert[] = [];
  const tcNames = new Set<string>();

  for (const block of blocks) {
    const tc = parseTcBlock(block, minLng, minLat, maxLng, maxLat);
    if (tc) {
      tcAlerts.push(tc);
      tcNames.add(normalizeStormToken(tc.title));
    }
  }

  for (const block of blocks) {
    const hazard = parseHazardBlock(block, tcNames);
    if (hazard) hazardAlerts.push(hazard);
    if (hazardAlerts.length >= 25) break;
  }

  return filterSubstantiveAlerts(dedupe([...tcAlerts, ...hazardAlerts]));
}

function parseTcBlock(
  block: string,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): GdacsAlert | null {
  if (!/<gdacs:eventtype>TC<\/gdacs:eventtype>/.test(block)) return null;
  if (!GDACS_IS_CURRENT.test(block)) return null;

  const id = firstRssMatch(block, /<gdacs:eventid>([\s\S]*?)<\/gdacs:eventid>/);
  const name =
    firstRssMatch(block, /<gdacs:eventname>([\s\S]*?)<\/gdacs:eventname>/) ??
    firstRssMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/);
  const lat = Number(firstRssMatch(block, /<geo:lat>([\s\S]*?)<\/geo:lat>/));
  const lng = Number(firstRssMatch(block, /<geo:long>([\s\S]*?)<\/geo:long>/));
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return null;

  const alertLevel = firstRssMatch(
    block,
    /<gdacs:alertlevel[^>]*>([\s\S]*?)<\/gdacs:alertlevel>/,
  );
  const severityRaw = block.match(
    /<gdacs:severity[^>]*value="([^"]+)"[^>]*>([\s\S]*?)<\/gdacs:severity>/,
  );
  const windKph = severityRaw ? Math.round(Number(severityRaw[1])) : 0;
  const severityText = severityRaw ? stripHtml(severityRaw[2]) : "";
  const link = firstRssMatch(block, /<link>([\s\S]*?)<\/link>/);
  const pubDate = firstRssMatch(block, /<pubDate>([\s\S]*?)<\/pubDate>/);
  const category = deriveCategory(alertLevel, severityText, windKph);
  const label = name ?? "Unknown";

  return {
    id: `tc-${id}`,
    source: "GDACS",
    severity: severityFromWind(windKph, category),
    title: `${label} — ${category}`,
    summary: `${windKph > 0 ? `${windKph} km/h` : "Intensity n/a"} · Active in PAR · ${severityText || "GDACS track"}`,
    issuedAt: pubDate ?? null,
    url: link ?? `https://www.gdacs.org/report.aspx?eventtype=TC&eventid=${id}`,
  };
}

function parseHazardBlock(block: string, tcNames: Set<string>): GdacsAlert | null {
  if (/<gdacs:eventtype>TC<\/gdacs:eventtype>/.test(block)) return null;
  if (!GDACS_IS_CURRENT.test(block)) return null;

  const title = firstRssMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/);
  const description = firstRssMatch(block, /<description[^>]*>([\s\S]*?)<\/description>/);
  const summary = stripHtml(description ?? "");
  if (summary.length < 40) return null;

  const country = firstRssMatch(block, /<gdacs:country[^>]*>([\s\S]*?)<\/gdacs:country>/);
  const phText =
    PH_RE.test(country ?? "") || PH_RE.test(title ?? "") || PH_RE.test(summary);
  if (!phText) return null;

  const alertTitle = title ?? "(no title)";
  if ([...tcNames].some((t) => t.length >= 4 && `${alertTitle} ${summary}`.toLowerCase().includes(t))) {
    return null;
  }

  const link = firstRssMatch(block, /<link>([\s\S]*?)<\/link>/);
  const pubDate = firstRssMatch(block, /<pubDate>([\s\S]*?)<\/pubDate>/);
  if (!isWithinMaxAge(pubDate, HAZARD_MAX_AGE_MS)) return null;

  const alertLevel = firstRssMatch(
    block,
    /<gdacs:alertlevel[^>]*>([\s\S]*?)<\/gdacs:alertlevel>/,
  );
  const identity = [link, alertTitle, pubDate, country, summary]
    .filter((v): v is string => Boolean(v))
    .join("|");
  if (!identity) return null;

  return {
    id: `gdacs-${hash(identity)}`,
    source: "GDACS",
    severity: mapSeverity(alertLevel),
    title: alertTitle,
    summary: summary.slice(0, 320),
    issuedAt: pubDate ?? null,
    url: link,
  };
}

function deriveCategory(
  alertLevel: string | undefined,
  severityText: string,
  windKph: number,
): string {
  if (/super|cat[\s-]?5/i.test(severityText) || windKph >= 252) return "Super typhoon";
  if (windKph >= 185) return "Typhoon";
  if (windKph >= 118) return "Severe tropical storm";
  if (windKph >= 89) return "Tropical storm";
  if (windKph >= 62) return "Tropical depression";
  return alertLevel ? `${alertLevel} alert` : "Tropical cyclone";
}

function severityFromWind(windKph: number, category: string): GdacsAlert["severity"] {
  const cat = category.toLowerCase();
  if (windKph >= 118 || /typhoon|super/.test(cat)) return "emergency";
  if (windKph >= 89 || /severe/.test(cat)) return "warning";
  if (windKph >= 62) return "watch";
  return "info";
}

function mapSeverity(level?: string): GdacsAlert["severity"] {
  switch ((level ?? "").toLowerCase()) {
    case "red":
      return "emergency";
    case "orange":
      return "warning";
    case "green":
      return "watch";
    default:
      return "info";
  }
}

function normalizeStormToken(title: string) {
  return title.split(/[—–(-]/)[0].trim().toLowerCase();
}

function dedupe(alerts: GdacsAlert[]): GdacsAlert[] {
  const seen = new Set<string>();
  const out: GdacsAlert[] = [];
  for (const a of alerts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function isWithinMaxAge(pubDate: string | undefined, maxAgeMs: number): boolean {
  if (!pubDate) return true;
  const ms = Date.parse(pubDate);
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms <= maxAgeMs;
}
