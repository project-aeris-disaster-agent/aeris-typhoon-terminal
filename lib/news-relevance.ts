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

export function rankAndFilterNewsItems<
  T extends { title: string; publishedAt: string },
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

  if (options?.preFiltered) {
    return sorted;
  }

  const strict = sorted.filter((item) => item.relevance >= 2);
  if (strict.length >= minItems) return strict;

  const relaxed = sorted.filter((item) => item.relevance >= 1);
  if (relaxed.length >= minItems) return relaxed;

  return sorted.slice(0, Math.max(minItems, 15));
}
