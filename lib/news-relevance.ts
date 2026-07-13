import { TYPHOON_KEYWORDS } from "@/config/feeds";

/** Strong hazard / weather terms — one match is enough to include. */
const STRONG_KEYWORDS = [
  "typhoon",
  "bagyo",
  "tropical cyclone",
  "tropical depression",
  "tropical storm",
  "super typhoon",
  "pagasa",
  "dost-pagasa",
  "signal no",
  "signal no.",
  "tropical cyclone wind signal",
  "landfall",
  "low pressure area",
  "lpa ",
  " lpa",
  "storm surge",
  "habagat",
  "amihan",
  "itcz",
  "intertropical",
];

/** Broader disaster / weather context — usually need one strong or two weak matches. */
const WEAK_KEYWORDS = [
  ...TYPHOON_KEYWORDS,
  "weather",
  "rainfall",
  "monsoon",
  "cyclone",
  "hurricane",
  "depression",
  "flood",
  "flooding",
  "landslide",
  "mudslide",
  "earthquake",
  "quake",
  "magnitude",
  "aftershock",
  "tsunami",
  "volcanic",
  "eruption",
  "disaster",
  "calamity",
  "evacuate",
  "evacuee",
  "rescue",
  "relief",
  "ndrrmc",
  "red cross",
  "damaged",
  "collapsed",
  "rubble",
  "casualt",
  "injured",
  "missing",
  "drowned",
  "heat index",
  "heatwave",
  "drought",
  "el nino",
  "la nina",
  "thunderstorm",
  "lightning",
  "gale",
  "gust",
  "wind speed",
  "heavy rain",
  "torrential",
];

export type ScoredNewsItem = {
  id: string;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  relevance: number;
};

export function normalizeNewsTitle(title: string): string {
  return title
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function scoreNewsRelevance(title: string): number {
  const t = normalizeNewsTitle(title).toLowerCase();
  let score = 0;
  for (const k of STRONG_KEYWORDS) {
    if (t.includes(k)) score += 3;
  }
  for (const k of WEAK_KEYWORDS) {
    if (t.includes(k)) score += 1;
  }
  return score;
}

export function isRelevantNewsTitle(title: string): boolean {
  return scoreNewsRelevance(title) >= 2;
}

/** Split `Headline - Outlet` titles from Google News RSS. */
const PH_CONTEXT_KEYWORDS = [
  "philippines",
  "philippine",
  "filipino",
  "manila",
  "luzon",
  "visayas",
  "mindanao",
  "pagasa",
  "metro manila",
  "par",
  "surigao",
  "pampanga",
  "cebu",
  "davao",
  "quezon",
  "baguio",
  "palawan",
  "ilocos",
  "bicol",
  "cagayan",
];

const LOW_QUALITY_SOURCES = new Set([
  "facebook.com",
  "fb.com",
  "twitter.com",
  "x.com",
]);

export function hasPhilippinesContext(title: string): boolean {
  const t = normalizeNewsTitle(title).toLowerCase();
  return PH_CONTEXT_KEYWORDS.some((k) => t.includes(k));
}

export function splitGoogleNewsTitle(title: string): {
  title: string;
  source?: string;
} {
  const normalized = normalizeNewsTitle(title);
  const match = normalized.match(/^(.+?)\s+-\s+([^-]+)$/);
  if (!match) return { title: normalized };
  const outlet = match[2].trim();
  if (LOW_QUALITY_SOURCES.has(outlet.toLowerCase())) {
    return { title: match[1].trim() };
  }
  return { title: match[1].trim(), source: outlet };
}

/** Stable key for collapsing the same headline across feeds/outlets. */
export function newsTitleDedupeKey(title: string): string {
  return normalizeNewsTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAggregatorUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "news.google.com" || host.endsWith(".google.com");
  } catch {
    return false;
  }
}

/**
 * Prefer a direct publisher link over a Google News redirect when the same
 * story appears in both aggregator and outlet feeds.
 */
export function preferNewsItem<
  T extends { url: string; publishedAt?: string; relevance?: number },
>(a: T, b: T): T {
  const aAgg = isAggregatorUrl(a.url);
  const bAgg = isAggregatorUrl(b.url);
  if (aAgg !== bAgg) return aAgg ? b : a;

  const aRel = a.relevance ?? 0;
  const bRel = b.relevance ?? 0;
  if (aRel !== bRel) return bRel > aRel ? b : a;

  const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  if (aTime !== bTime) return bTime > aTime ? b : a;

  return a;
}

/**
 * Collapse duplicate headlines that arrive from multiple RSS sources
 * (e.g. Google News + Rappler) under the same normalized title or URL.
 * Preserves first-seen order so callers should pass relevance-ranked lists.
 */
export function dedupeNewsItems<
  T extends { title: string; url: string; publishedAt?: string; relevance?: number },
>(items: T[]): T[] {
  const byTitle = new Map<string, T>();
  const byUrl = new Map<string, string>();
  const order: string[] = [];

  for (const item of items) {
    const titleKey = newsTitleDedupeKey(item.title);
    if (!titleKey) continue;
    const urlKey = item.url.trim().toLowerCase();

    const titleOwner = byUrl.get(urlKey);
    if (titleOwner && titleOwner !== titleKey) {
      // Same URL already kept under another title key — skip.
      continue;
    }

    const existing = byTitle.get(titleKey);
    if (existing) {
      const kept = preferNewsItem(existing, item);
      if (kept !== existing) {
        byUrl.delete(existing.url.trim().toLowerCase());
        byTitle.set(titleKey, kept);
        byUrl.set(kept.url.trim().toLowerCase(), titleKey);
      }
      continue;
    }

    byTitle.set(titleKey, item);
    byUrl.set(urlKey, titleKey);
    order.push(titleKey);
  }

  return order.map((key) => byTitle.get(key)!);
}

export function rankAndFilterNewsItems<
  T extends { title: string; url: string; publishedAt: string },
>(
  items: T[],
  options?: { minItems?: number; preFiltered?: boolean },
): Array<T & { relevance: number }> {
  const minItems = options?.minItems ?? 10;
  const scored = items.map((item) => ({
    ...item,
    relevance: scoreNewsRelevance(item.title),
  }));

  const sorted = [...scored]
    .filter(
      (item) =>
        hasPhilippinesContext(item.title) || item.relevance >= 3,
    )
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return (
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
    });

  let ranked: Array<T & { relevance: number }>;
  if (options?.preFiltered) {
    ranked = sorted;
  } else {
    const strict = sorted.filter((item) => item.relevance >= 2);
    if (strict.length >= minItems) {
      ranked = strict;
    } else {
      const relaxed = sorted.filter((item) => item.relevance >= 1);
      ranked =
        relaxed.length >= minItems
          ? relaxed
          : sorted.slice(0, Math.max(minItems, 15));
    }
  }

  // Dedupe after ranking so the highest-scoring / preferred URL wins.
  return dedupeNewsItems(ranked);
}
