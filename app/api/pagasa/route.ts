import { jsonError, jsonOk } from "@/lib/api-response";
import { withBreaker } from "@/lib/circuit-breaker";

export const runtime = "edge";
export const revalidate = 3600;

// PAGASA has no public structured feed, so this route scrapes bulletin links.

const PAGASA_URL = "https://www.pagasa.dost.gov.ph/weather";

export async function GET() {
  try {
    const html = await withBreaker(
      "pagasa",
      async () => {
        const res = await fetch(PAGASA_URL, {
          next: { revalidate: 3600 },
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; AERIS-Typhoon-Terminal/1.0; +https://aeris.ph)",
            accept: "text/html",
          },
        });
        if (!res.ok) throw new Error(`PAGASA ${res.status}`);
        return res.text();
      },
      { cooldownMs: 300_000, timeoutMs: 12_000 },
    );

    const alerts = parsePagasaHtml(html);
    return jsonOk({ alerts }, 3600);
  } catch (e) {
    return jsonError((e as Error).message, 502, { alerts: [] });
  }
}

function parsePagasaHtml(html: string) {
  const alerts: Array<{
    id: string;
    source: "PAGASA";
    severity: "info" | "watch" | "warning" | "emergency";
    title: string;
    summary: string;
    issuedAt: string | null;
    url?: string;
  }> = [];

  const cards = html.match(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,240}?)<\/a>/gi,
  ) ?? [];

  for (const card of cards) {
    const hrefMatch = /href=["']([^"']+)["']/i.exec(card);
    const textMatch = card.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!hrefMatch || !textMatch) continue;

    if (!/tropical|cyclone|typhoon|signal|bulletin|advisory|warning/i.test(textMatch)) {
      continue;
    }

    const href = hrefMatch[1];
    const url = href.startsWith("http")
      ? href
      : `https://www.pagasa.dost.gov.ph${href.startsWith("/") ? "" : "/"}${href}`;

    alerts.push({
      id: `pagasa-${hash(url)}`,
      source: "PAGASA",
      severity: inferSeverity(textMatch),
      title: textMatch.slice(0, 140),
      summary: textMatch.slice(0, 240),
      issuedAt: extractIssuedAt(textMatch),
      url,
    });
    if (alerts.length >= 10) break;
  }

  return dedupeById(alerts);
}

function inferSeverity(
  text: string,
): "info" | "watch" | "warning" | "emergency" {
  if (/signal\s*#?\s*[45]/i.test(text)) return "emergency";
  if (/signal\s*#?\s*[23]|typhoon|super\s*typhoon/i.test(text))
    return "warning";
  if (/signal\s*#?\s*1|tropical\s*storm|depression/i.test(text))
    return "watch";
  return "info";
}

function extractIssuedAt(text: string): string | null {
  const monthDayYear = text.match(
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:am|pm))?/i,
  );
  if (monthDayYear) {
    const parsed = new Date(monthDayYear[0]);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  const isoLike = text.match(/\b\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?\b/i);
  if (isoLike) {
    const parsed = new Date(isoLike[0]);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
