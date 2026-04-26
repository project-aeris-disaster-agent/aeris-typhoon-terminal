export type FeedSource = {
  id: string;
  name: string;
  url: string;
  tier: 1 | 2;
};

/**
 * Philippine news RSS feed registry.
 *
 * Tier 1: Major national outlets (used by default).
 * Tier 2: Regional / specialist sources (opt-in).
 *
 * All RSS fetches go through the Vercel edge proxy at /api/rss to avoid CORS.
 */
export const FEEDS: FeedSource[] = [
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
    id: "abscbn",
    name: "ABS-CBN News",
    url: "https://news.abs-cbn.com/rss",
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
];
