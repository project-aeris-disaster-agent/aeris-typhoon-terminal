/**
 * PAGASA "Daily Weather" scraper.
 *
 * Source: https://www.pagasa.dost.gov.ph/weather  (HTML-only, no public API).
 *
 * We extract a small, stable subset:
 *  - issuedAt header
 *  - synopsis paragraph
 *  - "Tropical Cyclone outside PAR" block (when present)
 *  - "Forecast Weather Conditions" table rows
 *
 * Layout drift is expected. Every selector is defensive; on parse failure we
 * return null and the caller treats PAGASA Daily as "not loaded" rather than
 * breaking the chat request. Cached in-process for 30 minutes.
 */

const PAGASA_DAILY_URL = "https://www.pagasa.dost.gov.ph/weather";
const CACHE_TTL_MS = 30 * 60 * 1000;

export type PagasaDailyTc = {
  name: string;
  location: string;
  maxWindsKmh?: string;
  gustinessKmh?: string;
  movement?: string;
};

/** Parse "65 KM/H NEAR THE CENTER" → 65. */
export function parseKmhFromPagasaField(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*km\/h/i);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type PagasaDailyRegion = {
  place: string;
  condition: string;
  causedBy?: string;
  impacts?: string;
};

export type PagasaDaily = {
  source: "pagasa-daily";
  url: string;
  fetchedAt: string;
  issuedAt: string | null;
  synopsis: string | null;
  tcOutsidePar: PagasaDailyTc | null;
  regionalConditions: PagasaDailyRegion[];
};

let cache: { at: number; value: PagasaDaily | null } | null = null;
let inFlight: Promise<PagasaDaily | null> | null = null;

/**
 * Strip HTML tags and collapse whitespace from a fragment.
 * Keeps things dependency-free (no cheerio).
 */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&deg;/gi, "°")
    .replace(/\s+/g, " ")
    .trim();
}

function extractIssuedAt(html: string): string | null {
  const match = html.match(/Issued at:?\s*([^<\n]+?)\s*<\/(?:b|strong|p|h\d)/i);
  if (!match) return null;
  return stripTags(match[1]).replace(/\*+/g, "").trim() || null;
}

function extractSynopsis(html: string): string | null {
  const match = html.match(/Synopsis[\s\S]{0,200}?<\/(?:h\d|b|strong)>([\s\S]*?)(?:<table|<h\d|<strong>TC|TC Information)/i);
  if (!match) return null;
  const text = stripTags(match[1]);
  if (!text || text.length < 10) return null;
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

function extractTcOutsidePar(html: string): PagasaDailyTc | null {
  // Locate the TC table by its heading text.
  const heading = html.search(/TROPICAL\s+CYCLONE\s+OUTSIDE\s+PAR/i);
  if (heading < 0) return null;

  const tableEnd = html.indexOf("</table>", heading);
  if (tableEnd < 0) return null;
  const tableHtml = html.slice(heading, tableEnd + "</table>".length);

  const cellTexts: string[] = [];
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(tableHtml)) !== null) {
    cellTexts.push(stripTags(m[1]));
  }

  // Cells appear as label/value pairs OR as single-cell lines like "LOCATION: ...".
  const findValue = (label: RegExp): string | undefined => {
    for (const cell of cellTexts) {
      const r = new RegExp(`${label.source}\\s*:?\\s*(.+)`, "i");
      const mm = cell.match(r);
      if (mm) return mm[1].trim();
    }
    return undefined;
  };

  const nameCell = cellTexts.find((c) =>
    /TROPICAL\s+(?:STORM|DEPRESSION|CYCLONE|TYPHOON|SUPER\s+TYPHOON|SEVERE\s+TROPICAL\s+STORM)/i.test(c),
  );

  const name = nameCell ? nameCell.trim() : "Tropical Cyclone outside PAR";
  const location = findValue(/LOCATION/) ?? "";
  if (!location) return null;

  return {
    name,
    location,
    maxWindsKmh: findValue(/MAXIMUM\s+SUSTAINED\s+WINDS/),
    gustinessKmh: findValue(/GUSTINESS/),
    movement: findValue(/MOVEMENT/),
  };
}

function extractRegionalConditions(html: string): PagasaDailyRegion[] {
  const heading = html.search(/Forecast\s+Weather\s+Conditions/i);
  if (heading < 0) return [];

  const tableEnd = html.indexOf("</table>", heading);
  if (tableEnd < 0) return [];
  const tableHtml = html.slice(heading, tableEnd + "</table>".length);

  const rows: PagasaDailyRegion[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  let first = true;
  while ((m = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(m[1])) !== null) {
      cells.push(stripTags(c[1]));
    }
    if (first) {
      first = false;
      if (cells.some((cell) => /place|weather|caused/i.test(cell))) continue;
    }
    if (cells.length < 2) continue;
    const [place, condition, causedBy, impacts] = cells;
    if (!place || !condition) continue;
    rows.push({
      place,
      condition,
      causedBy: causedBy || undefined,
      impacts: impacts || undefined,
    });
    if (rows.length >= 6) break;
  }
  return rows;
}

export function parsePagasaDailyHtml(html: string): PagasaDaily | null {
  try {
    const issuedAt = extractIssuedAt(html);
    const synopsis = extractSynopsis(html);
    const tcOutsidePar = extractTcOutsidePar(html);
    const regionalConditions = extractRegionalConditions(html);

    if (!issuedAt && !synopsis && !tcOutsidePar && regionalConditions.length === 0) {
      return null;
    }

    return {
      source: "pagasa-daily",
      url: PAGASA_DAILY_URL,
      fetchedAt: new Date().toISOString(),
      issuedAt,
      synopsis,
      tcOutsidePar,
      regionalConditions,
    };
  } catch {
    return null;
  }
}

export async function fetchPagasaDailyWeather(): Promise<PagasaDaily | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(PAGASA_DAILY_URL, {
        headers: {
          "user-agent":
            "AERIS-Dashboard/1.0 (+disaster-resilience; contact via repo)",
          accept: "text/html,application/xhtml+xml",
        },
        next: { revalidate: 1800 },
      });
      if (!res.ok) {
        cache = { at: Date.now(), value: null };
        return null;
      }
      const html = await res.text();
      const parsed = parsePagasaDailyHtml(html);
      cache = { at: Date.now(), value: parsed };
      return parsed;
    } catch {
      cache = { at: Date.now(), value: null };
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test-only: reset the in-memory cache between unit tests. */
export function __resetPagasaDailyCache() {
  cache = null;
  inFlight = null;
}
