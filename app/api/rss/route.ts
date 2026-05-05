import { jsonOkNoStore } from "@/lib/api-response";
import { withBreaker, CircuitOpenError } from "@/lib/circuit-breaker";
import { FEEDS, TYPHOON_KEYWORDS } from "@/config/feeds";

export const runtime = "edge";
/** Always run fresh aggregation; avoid CDN / Data Cache staleness on top of the client poll. */
export const dynamic = "force-dynamic";

type NewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
};

export async function GET() {
  const tier1Feeds = FEEDS.filter((feed) => feed.tier === 1);
  const results = await Promise.allSettled(
    tier1Feeds.map((feed) =>
      withBreaker(`rss:${feed.id}`, () => fetchFeed(feed.url, feed.name), {
        cooldownMs: 300_000,
        timeoutMs: 8_000,
      }),
    ),
  );

  const all: NewsItem[] = [];
  const errors: string[] = [];

  results.forEach((r, i) => {
    const feed = tier1Feeds[i];
    if (r.status === "fulfilled") {
      all.push(...r.value);
    } else if (!(r.reason instanceof CircuitOpenError)) {
      errors.push(`${feed.id}: ${(r.reason as Error).message}`);
    }
  });

  const filtered = all
    .filter((it) => isRelevant(it.title))
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() -
        new Date(a.publishedAt).getTime(),
    )
    .slice(0, 80);

  return jsonOkNoStore({ items: filtered, errors });
}

function isRelevant(title: string): boolean {
  const t = title.toLowerCase();
  return TYPHOON_KEYWORDS.some((k) => t.includes(k));
}

async function fetchFeed(url: string, source: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (compatible; AERIS-Typhoon-Terminal/1.0)",
      accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`${source} ${res.status}`);
  const xml = await res.text();
  if (
    xml.includes("Access Denied") ||
    (xml.trimStart().startsWith("<!DOCTYPE") && !xml.includes("<rss"))
  ) {
    throw new Error(`${source}: blocked or non-RSS response (WAF/HTML)`);
  }
  return parseRss(xml, source);
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks.slice(0, 25)) {
    const title = firstMatch(b, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const link = firstMatch(b, /<link[^>]*>([\s\S]*?)<\/link>/i);
    const date =
      firstMatch(b, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ??
      firstMatch(b, /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i) ??
      new Date().toISOString();
    if (!title || !link) continue;
    items.push({
      id: `${source}-${hash(link)}`,
      source,
      title,
      url: link,
      publishedAt: new Date(date).toISOString(),
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

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
