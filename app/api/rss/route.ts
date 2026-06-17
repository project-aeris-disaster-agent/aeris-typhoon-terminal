import { jsonOkNoStore } from "@/lib/api-response";
import { withBreaker, CircuitOpenError } from "@/lib/circuit-breaker";
import {
  rankAndFilterNewsItems,
  splitGoogleNewsTitle,
  normalizeNewsTitle,
} from "@/lib/news-relevance";
import { FEEDS, NEWS_MIN_ITEMS, type FeedSource } from "@/config/feeds";

export const runtime = "edge";
/** Always run fresh aggregation; avoid CDN / Data Cache staleness on top of the client poll. */
export const dynamic = "force-dynamic";

type NewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  imageUrl?: string;
};

export async function GET() {
  const tier1Feeds = FEEDS.filter((feed) => feed.tier === 1);
  const results = await Promise.allSettled(
    tier1Feeds.map((feed) =>
      withBreaker(`rss:${feed.id}`, () => fetchFeed(feed), {
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

  const ranked = rankAndFilterNewsItems(all, {
    minItems: NEWS_MIN_ITEMS,
  });

  const filtered = ranked
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, 80)
    .map(({ relevance: _relevance, ...item }) => item);

  return jsonOkNoStore({ items: filtered, errors });
}

async function fetchFeed(feed: FeedSource): Promise<NewsItem[]> {
  const res = await fetch(feed.url, {
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; AERIS-Typhoon-Terminal/1.0)",
      accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`${feed.name} ${res.status}`);
  const xml = await res.text();
  if (
    xml.includes("Access Denied") ||
    (xml.trimStart().startsWith("<!DOCTYPE") && !xml.includes("<rss"))
  ) {
    throw new Error(`${feed.name}: blocked or non-RSS response (WAF/HTML)`);
  }
  const items = parseRss(xml, feed.name);
  if (feed.preFiltered) {
    return items.map((item) => normalizeGoogleItem(item));
  }
  return items;
}

function normalizeGoogleItem(item: NewsItem): NewsItem {
  const split = splitGoogleNewsTitle(item.title);
  return {
    ...item,
    title: split.title,
    source: split.source ?? "Google News",
  };
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
    const cleanTitle = normalizeNewsTitle(title);
    items.push({
      id: `${source}-${hash(link)}`,
      source,
      title: cleanTitle,
      url: link,
      publishedAt: new Date(date).toISOString(),
      imageUrl: extractImage(b),
    });
  }
  return items;
}

/** Pull a usable article thumbnail from common RSS image conventions. */
function extractImage(block: string): string | undefined {
  const media = block.match(
    /<media:(?:content|thumbnail)[^>]*\burl=["']([^"']+)["']/i,
  );
  if (media) return cleanImageUrl(media[1]);

  const enclosure = block.match(/<enclosure\b[^>]*>/i)?.[0];
  if (enclosure && /image|\.(?:jpe?g|png|webp|gif)/i.test(enclosure)) {
    const url = enclosure.match(/\burl=["']([^"']+)["']/i)?.[1];
    if (url) return cleanImageUrl(url);
  }

  const img = block.match(/<img[^>]*\bsrc=["']([^"']+)["']/i);
  if (img) return cleanImageUrl(img[1]);

  return undefined;
}

function cleanImageUrl(url: string): string | undefined {
  const trimmed = decodeEntities(url).trim();
  return trimmed.startsWith("http") ? trimmed : undefined;
}

function firstMatch(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  if (!m) return undefined;
  return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    )
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
