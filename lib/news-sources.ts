/**
 * Maps a news item to a brand domain so we can render a recognizable source
 * logo. Google News normalizes `source` to the real outlet name (e.g.
 * "Inquirer.net"), but its `url` is a news.google.com redirect — so we prefer
 * matching on the source name and only fall back to the article hostname.
 */
const SOURCE_DOMAINS: Array<{ match: RegExp; domain: string }> = [
  // Philippine national outlets
  { match: /rappler/i, domain: "rappler.com" },
  { match: /inquirer/i, domain: "inquirer.net" },
  { match: /gma/i, domain: "gmanetwork.com" },
  { match: /phil\s?star|philstar/i, domain: "philstar.com" },
  { match: /manila bulletin|\bmb\.com/i, domain: "mb.com.ph" },
  { match: /abs[-\s]?cbn/i, domain: "abs-cbn.com" },
  { match: /sunstar|sun\.star/i, domain: "sunstar.com.ph" },
  { match: /manila times/i, domain: "manilatimes.net" },
  { match: /manila standard/i, domain: "manilastandard.net" },
  { match: /business\s?world|bworld/i, domain: "bworldonline.com" },
  { match: /business\s?mirror/i, domain: "businessmirror.com.ph" },
  { match: /daily tribune|tribune/i, domain: "tribune.net.ph" },
  { match: /pna|philippine news agency/i, domain: "pna.gov.ph" },
  { match: /\bptv\b|people'?s television/i, domain: "ptvnews.ph" },
  { match: /one news|onenews/i, domain: "onenews.ph" },
  { match: /interaksyon/i, domain: "interaksyon.philstar.com" },
  { match: /panay news/i, domain: "panaynews.net" },
  { match: /mindanao/i, domain: "mindanews.com" },
  { match: /\bdzrh\b/i, domain: "dzrh.com.ph" },
  { match: /bombo radyo/i, domain: "bomboradyo.com" },
  { match: /remate/i, domain: "remate.ph" },
  { match: /abante/i, domain: "abante.com.ph" },
  { match: /journal|people'?s journal/i, domain: "journal.com.ph" },
  { match: /\bpep\.ph|philippine entertainment/i, domain: "pep.ph" },
  { match: /pagasa|dost/i, domain: "pagasa.dost.gov.ph" },
  { match: /phivolcs/i, domain: "phivolcs.dost.gov.ph" },
  { match: /\bndrrmc\b/i, domain: "ndrrmc.gov.ph" },
  // International wire services / outlets commonly surfaced by Google News
  { match: /cnn philippines/i, domain: "cnnphilippines.com" },
  { match: /\bcnn\b/i, domain: "cnn.com" },
  { match: /reuters/i, domain: "reuters.com" },
  { match: /associated press|\bap news\b|\bap\b/i, domain: "apnews.com" },
  { match: /\bafp\b|agence france/i, domain: "afp.com" },
  { match: /\bbbc\b/i, domain: "bbc.com" },
  { match: /bloomberg/i, domain: "bloomberg.com" },
  { match: /al ?jazeera/i, domain: "aljazeera.com" },
  { match: /the guardian|\bguardian\b/i, domain: "theguardian.com" },
  { match: /new york times|\bnyt\b/i, domain: "nytimes.com" },
  { match: /washington post/i, domain: "washingtonpost.com" },
  { match: /south china morning post|\bscmp\b/i, domain: "scmp.com" },
  { match: /\bnhk\b/i, domain: "nhk.or.jp" },
  { match: /channel news asia|\bcna\b/i, domain: "channelnewsasia.com" },
  { match: /agenzia fides|fides/i, domain: "fides.org" },
  { match: /\bxinhua\b/i, domain: "xinhuanet.com" },
  { match: /vatican/i, domain: "vaticannews.va" },
  { match: /yahoo/i, domain: "yahoo.com" },
  { match: /\bmsn\b/i, domain: "msn.com" },
  { match: /\beuronews\b/i, domain: "euronews.com" },
  { match: /\bzoom\s?earth|zoomearth/i, domain: "zoom.earth" },
  { match: /accuweather/i, domain: "accuweather.com" },
  { match: /\bnoaa\b/i, domain: "noaa.gov" },
];

export type NewsSourceRef = { source: string; url: string };

/**
 * Detect a domain embedded in the source label itself.
 * Google News often labels outlets as "Inquirer.net", "Philstar.com",
 * "mb.com.ph", etc. — which are usable domains as-is.
 */
function domainFromSourceLabel(source: string): string | null {
  const cleaned = source.trim().toLowerCase();
  const match = cleaned.match(
    /\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|ph|gov|edu|va|jp|asia)(?:\.[a-z]{2})?)\b/,
  );
  return match ? match[1].replace(/^www\./, "") : null;
}

/** Resolve the brand domain used for logo/favicon lookups, or null if unknown. */
export function getNewsSourceDomain(item: NewsSourceRef): string | null {
  for (const entry of SOURCE_DOMAINS) {
    if (entry.match.test(item.source)) return entry.domain;
  }

  const labelDomain = domainFromSourceLabel(item.source);
  if (labelDomain) return labelDomain;

  try {
    const host = new URL(item.url).hostname.replace(/^www\./, "");
    if (host && !host.includes("news.google.com")) return host;
  } catch {
    // ignore malformed URLs and fall through
  }

  return null;
}

/**
 * Source logo URL via Google's favicon service. Returns null when the source
 * can't be resolved to a real domain, so the UI can render a branded letter
 * avatar instead of a generic globe placeholder.
 */
export function getNewsSourceLogo(
  item: NewsSourceRef,
  size = 128,
): string | null {
  const domain = getNewsSourceDomain(item);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}
