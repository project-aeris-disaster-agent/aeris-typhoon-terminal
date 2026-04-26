import { jsonError, jsonOk } from "@/lib/api-response";
import { withBreaker } from "@/lib/circuit-breaker";

export const runtime = "edge";
export const revalidate = 600;

type GdacsRssItem = {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  "gdacs:eventtype"?: string;
  "gdacs:alertlevel"?: string;
  "gdacs:country"?: string;
};

export async function GET() {
  try {
    const xml = await withBreaker(
      "gdacs-rss",
      async () => {
        const res = await fetch("https://www.gdacs.org/xml/rss.xml", {
          next: { revalidate: 600 },
          headers: { accept: "application/rss+xml" },
        });
        if (!res.ok) throw new Error(`GDACS RSS ${res.status}`);
        return res.text();
      },
      { cooldownMs: 60_000, timeoutMs: 10_000 },
    );

    const items = parseRss(xml);
    const alerts = items
      .filter(
        (it) =>
          /philippines|luzon|visayas|mindanao/i.test(it.country ?? "") ||
          /philippines|luzon|visayas|mindanao/i.test(it.title ?? "") ||
          /philippines|luzon|visayas|mindanao/i.test(it.description ?? ""),
      )
      .slice(0, 30)
      .flatMap((it) => {
        const identity = [...[it.link, it.title, it.pubDate, it.country], it.description]
          .filter((value): value is string => Boolean(value))
          .join("|");
        if (!identity) return [];
        return [{
          id: `gdacs-${hash(identity)}`,
        source: "GDACS" as const,
        severity: mapSeverity(it.alertLevel),
        title: it.title ?? "(no title)",
        summary: stripHtml(it.description ?? "").slice(0, 240),
        issuedAt: it.pubDate ?? null,
        url: it.link,
      }];
      });

    return jsonOk({ alerts }, 600);
  } catch (e) {
    return jsonOk({ alerts: [], _error: (e as Error).message }, 30);
  }
}

type ParsedItem = {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  country?: string;
  alertLevel?: string;
};

function parseRss(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const b of blocks) {
    items.push({
      title: firstMatch(b, /<title[^>]*>([\s\S]*?)<\/title>/),
      description: firstMatch(b, /<description[^>]*>([\s\S]*?)<\/description>/),
      link: firstMatch(b, /<link[^>]*>([\s\S]*?)<\/link>/),
      pubDate: firstMatch(b, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/),
      country: firstMatch(b, /<gdacs:country[^>]*>([\s\S]*?)<\/gdacs:country>/),
      alertLevel: firstMatch(
        b,
        /<gdacs:alertlevel[^>]*>([\s\S]*?)<\/gdacs:alertlevel>/,
      ),
    });
  }
  return items;
}

function firstMatch(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  if (!m) return undefined;
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function mapSeverity(level?: string): "info" | "watch" | "warning" | "emergency" {
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

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
