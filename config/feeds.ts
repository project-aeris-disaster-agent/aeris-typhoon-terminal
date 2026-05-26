export type FeedSource = {
  id: string;
  name: string;
  url: string;
  tier: 1 | 2;
  /**
   * Feed is already scoped to PH weather/disaster (e.g. Google News search).
   * Skip outlet keyword gate; items are ranked by relevance score only.
   */
  preFiltered?: boolean;
};

/**
 * Philippine news RSS feed registry.
 *
 * Tier 1: Major national outlets (used by default).
 * Tier 2: Regional / specialist sources (opt-in).
 *
 * All RSS fetches go through the Vercel edge proxy at /api/rss to avoid CORS.
 *
 * Note: news.abs-cbn.com/rss returns HTTP 500/403 to server-side fetchers (WAF).
 * ABS-CBN coverage is supplemented via Google News PH search feeds below.
 */
export const FEEDS: FeedSource[] = [
  {
    id: "google-ph-weather",
    name: "Google News (PH Weather)",
    url: "https://news.google.com/rss/search?q=Philippines+(typhoon+OR+bagyo+OR+flood+OR+PAGASA+OR+monsoon)&hl=en-PH&gl=PH&ceid=PH:en",
    tier: 1,
    preFiltered: true,
  },
  {
    id: "google-ph-disaster",
    name: "Google News (PH Disasters)",
    url: "https://news.google.com/rss/search?q=Philippines+(earthquake+OR+landslide+OR+evacuation+OR+rescue+OR+calamity)&hl=en-PH&gl=PH&ceid=PH:en",
    tier: 1,
    preFiltered: true,
  },
  {
    id: "rappler",
    name: "Rappler",
    url: "https://www.rappler.com/feed/",
    tier: 1,
  },
  {
    id: "inquirer",
    name: "Inquirer.net",
    url: "https://www.inquirer.net/fullfeed",
    tier: 1,
  },
  {
    id: "gma",
    name: "GMA News",
    url: "https://data.gmanetwork.com/gno/rss/news/feed.xml",
    tier: 1,
  },
  {
    id: "philstar",
    name: "Philippine Star",
    url: "https://www.philstar.com/rss/headlines",
    tier: 1,
  },
  {
    id: "manila-bulletin",
    name: "Manila Bulletin",
    url: "https://mb.com.ph/feed",
    tier: 2,
  },
];

export const TYPHOON_KEYWORDS = [
  "typhoon",
  "tropical",
  "storm",
  "bagyo",
  "flood",
  "landslide",
  "pagasa",
  "ndrrmc",
  "rescue",
  "evacuation",
  "signal",
  "weather",
  "earthquake",
  "monsoon",
  "cyclone",
  "rain",
  "habagat",
  "calamity",
  "disaster",
];

/** Minimum headlines returned when any source succeeds. */
export const NEWS_MIN_ITEMS = 10;
