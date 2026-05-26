import { extractCctvLocation } from "@/services/cctv-locations";
import type { YtFeedResult, YtVideo } from "@/lib/youtube-feed/types";

const BROWSER_HEADERS: HeadersInit = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/** In-process caches so repeated hot reloads don't hammer YouTube */
const rssUrlCache = new Map<string, string>();
const channelIdCache = new Map<string, string>();
const xmlCache = new Map<string, { xml: string; at: number }>();
/** Keep RSS relatively fresh so ended streams drop off the Atom ordering sooner */
const XML_TTL = 15_000;
const oembedCache = new Map<
  string,
  {
    embeddable: boolean;
    at: number;
  }
>();
const OEMBED_TTL = 5 * 60 * 1000;

/** Channel /live HTML scrape — cheap live detection without YouTube Data API */
const livePageCache = new Map<
  string,
  { videoId: string | null; at: number }
>();
const LIVE_PAGE_TTL = 12_000;

/**
 * Cache for search.list?eventType=live results. Each search costs 100 quota
 * units (vs 1 for videos.list), so we cache aggressively. 60s is short
 * enough that newly-started streams appear within ~1 refresh cycle.
 */
const liveSearchCache = new Map<
  string,
  { videos: YtVideo[]; at: number }
>();
const LIVE_SEARCH_TTL = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Supabase shared cache — survives cold starts and is shared across all
// server instances. We cache search.list results here because each call
// costs 100 YouTube Data API quota units.
// ---------------------------------------------------------------------------

/** TTL for the Supabase-persisted live-search cache (10 minutes). */
const SUPABASE_LIVE_CACHE_TTL_MS = 10 * 60 * 1000;

function supabaseCacheConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function supabaseHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
}

/** Read a cached live-search result from Supabase. Returns null on miss or error. */
async function readSupabaseLiveCache(channelId: string): Promise<YtVideo[] | null> {
  const cfg = supabaseCacheConfig();
  if (!cfg) return null;
  try {
    const params = new URLSearchParams({
      select: "videos,expires_at",
      channel_id: `eq.${channelId}`,
      limit: "1",
    });
    const res = await fetch(
      `${cfg.url}/rest/v1/youtube_feed_cache?${params}`,
      { headers: supabaseHeaders(cfg.serviceKey), cache: "no-store" },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      videos: unknown;
      expires_at: string;
    }>;
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) return null; // expired
    if (!Array.isArray(row.videos)) return null;
    return row.videos as YtVideo[];
  } catch {
    return null;
  }
}

/** Upsert a live-search result into Supabase. Fire-and-forget — errors are swallowed. */
async function writeSupabaseLiveCache(
  channelId: string,
  channelHandle: string,
  videos: YtVideo[],
): Promise<void> {
  const cfg = supabaseCacheConfig();
  if (!cfg) return;
  const expiresAt = new Date(Date.now() + SUPABASE_LIVE_CACHE_TTL_MS).toISOString();
  try {
    await fetch(`${cfg.url}/rest/v1/youtube_feed_cache`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(cfg.serviceKey),
        prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        channel_id: channelId,
        channel_handle: channelHandle,
        videos,
        fetched_at: new Date().toISOString(),
        expires_at: expiresAt,
      }),
    });
  } catch {
    // Non-critical — in-process cache still serves as fallback
  }
}

type LiveBroadcastContent = "live" | "upcoming" | "none";

type VideoEnrichment = {
  embeddable: boolean;
  liveBroadcastContent?: LiveBroadcastContent;
};

/** Extract UC… channel id from channel page HTML (RSS link, canonical, or JSON blobs). */
function extractChannelIdFromHtml(html: string): string | null {
  const patterns = [
    /feeds\/videos\.xml\?channel_id=(UC[\w-]{22,})/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22,})["']/i,
    /<link[^>]+href=["']https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22,})["'][^>]+rel=["']canonical["']/i,
    /"channelId"\s*:\s*"(UC[\w-]{22,})"/,
    /"externalChannelId"\s*:\s*"(UC[\w-]{22,})"/,
    /"browseId"\s*:\s*"(UC[\w-]{22,})"/,
    /\/channel\/(UC[\w-]{22,})/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Fetches the channel page at youtube.com/@handle and extracts the RSS feed
 * URL from the <link rel="alternate" type="application/rss+xml"> autodiscovery
 * tag that YouTube includes in every channel's <head>.
 */
async function resolveRssUrl(handle: string): Promise<string> {
  if (rssUrlCache.has(handle)) return rssUrlCache.get(handle)!;

  const url = `https://www.youtube.com/@${handle}`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok)
    throw new Error(`Channel page @${handle} → HTTP ${res.status}`);

  // Read enough of the document for <head> autodiscovery (RSS moved after large inline scripts).
  const reader = res.body?.getReader();
  let html = "";
  const maxBytes = 512 * 1024;
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.byteLength;
      if (
        html.includes("feeds/videos.xml") ||
        html.includes('rel="canonical"') && html.includes("/channel/UC")
      ) {
        break;
      }
    }
    reader.cancel();
  } else {
    html = await res.text();
  }

  const channelIdFromPage = extractChannelIdFromHtml(html);
  if (channelIdFromPage) {
    const rss = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdFromPage}`;
    rssUrlCache.set(handle, rss);
    channelIdCache.set(handle, channelIdFromPage);
    return rss;
  }

  const rssMatch = html.match(
    /href=["'](https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=(UC[\w-]{22,}))["']/i,
  );
  if (rssMatch) {
    const rssUrl = rssMatch[1];
    const idFromUrl = rssUrl.match(/channel_id=(UC[\w-]+)/i)?.[1];
    if (idFromUrl) channelIdCache.set(handle, idFromUrl);
    rssUrlCache.set(handle, rssUrl);
    return rssUrl;
  }

  throw new Error(`RSS link not found in page source for @${handle}`);
}

async function fetchChannelFeed(handle: string): Promise<YtVideo[]> {
  const clean = handle.replace(/^@/, "");
  let rssUrl = rssUrlCache.get(clean);
  if (!rssUrl) {
    const channelId = await resolveChannelId(clean);
    if (channelId) {
      rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      rssUrlCache.set(clean, rssUrl);
    } else {
      rssUrl = await resolveRssUrl(clean);
    }
  }

  const cached = xmlCache.get(rssUrl);
  if (cached && Date.now() - cached.at < XML_TTL) {
    return parseAtomFeed(cached.xml, clean);
  }

  const res = await fetch(rssUrl, {
    headers: { ...BROWSER_HEADERS, accept: "application/xml, text/xml, */*" },
  });
  if (!res.ok)
    throw new Error(`RSS feed @${clean} → HTTP ${res.status}`);

  const xml = await res.text();
  xmlCache.set(rssUrl, { xml, at: Date.now() });
  return parseAtomFeed(xml, clean);
}

function parseAtomFeed(xml: string, channelHandle: string): YtVideo[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const rawTitle = extractTag(xml, "title") ?? channelHandle;
  // The feed <title> often includes the channel name as plain text
  const channelName = rawTitle;

  return entries.slice(0, 30).map((entry) => {
    const rawId = extractTag(entry, "yt:videoId") ?? extractTag(entry, "id") ?? "";
    const videoId = rawId.replace(/^yt:video:/, "");
    const title = decodeEntities(extractTag(entry, "title") ?? "");
    const publishedAt =
      extractTag(entry, "published") ?? new Date().toISOString();
    const thumbnailUrl =
      extractAttr(entry, "media:thumbnail", "url") ??
      `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

    const tl = title.toLowerCase();
    // Heuristic "live-ish" titles (RSS has no real live flag). Avoid
    // tl.includes("stream") — it matches "mainstream", "upstream", etc.
    const isLiveKeyword =
      /\blive\b/.test(tl) ||
      tl.includes("24/7") ||
      tl.includes("cctv") ||
      tl.includes("webcam") ||
      tl.includes("livestream") ||
      tl.includes("live stream") ||
      /\bstreaming\b/.test(tl) ||
      tl.includes("broadcast");
    const isLongRunningLive =
      tl.includes("24/7") || tl.includes("cctv") || tl.includes("webcam");
    const hoursOld = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
    const maxLiveHours = isLongRunningLive ? 7 * 24 : 8;
    const isLikeLive = isLiveKeyword && hoursOld < maxLiveHours;

    return {
      id: videoId,
      title,
      publishedAt,
      thumbnailUrl,
      channelName,
      channelHandle,
      isLikeLive,
      embeddable: true,
    };
  });
}

async function fetchOEmbed(videoId: string): Promise<VideoEnrichment> {
  const cached = oembedCache.get(videoId);
  if (cached && Date.now() - cached.at < OEMBED_TTL) {
    return { embeddable: cached.embeddable };
  }

  const url =
    "https://www.youtube.com/oembed?url=" +
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`) +
    "&format=json";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const embeddable = res.ok;
  oembedCache.set(videoId, { embeddable, at: Date.now() });
  return { embeddable };
}

/**
 * Resolves a channel handle (without leading @) to a UC… channelId. Prefers
 * the Data API channels.list?forHandle when available (1 quota unit), falls
 * back to scraping the channel HTML which already populates channelIdCache.
 */
async function resolveChannelId(handle: string): Promise<string | null> {
  const cached = channelIdCache.get(handle);
  if (cached) return cached;

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const url = new URL("https://www.googleapis.com/youtube/v3/channels");
      url.searchParams.set("part", "id");
      url.searchParams.set("forHandle", `@${handle}`);
      url.searchParams.set("key", apiKey);
      const res = await fetch(url.toString(), {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as {
          items?: Array<{ id?: string }>;
        };
        const id = body.items?.[0]?.id;
        if (id && /^UC[\w-]{20,}$/.test(id)) {
          channelIdCache.set(handle, id);
          return id;
        }
      }
    } catch {
      /* fall through to RSS scrape */
    }
  }

  // Falling back to resolveRssUrl populates channelIdCache as a side effect.
  try {
    await resolveRssUrl(handle);
  } catch {
    return null;
  }
  return channelIdCache.get(handle) ?? null;
}

/**
 * Discover ALL currently-live videos for a channel via the Data API
 * search.list endpoint. This is the only reliable way to enumerate concurrent
 * livestreams — RSS only contains uploads, and HTML scraping returns just one
 * stream per channel page. Costs 100 quota units per call.
 *
 * Cache hierarchy (cheapest first):
 *   1. In-process Map (60s) — zero latency, per-instance
 *   2. Supabase shared table (3 min) — survives cold starts, cross-instance
 *   3. YouTube Data API search.list — 100 quota units, last resort
 */
async function searchLiveStreamsViaApi(
  apiKey: string,
  channelId: string,
  channelHandle: string,
): Promise<YtVideo[]> {
  const cacheKey = `${channelId}`;

  // 1. In-process cache
  const cached = liveSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LIVE_SEARCH_TTL) {
    return cached.videos;
  }

  // 2. Supabase shared cache
  const supabaseCached = await readSupabaseLiveCache(channelId);
  if (supabaseCached !== null) {
    // Populate in-process cache so subsequent calls in this instance are free
    liveSearchCache.set(cacheKey, { videos: supabaseCached, at: Date.now() });
    return supabaseCached;
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("eventType", "live");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("order", "date");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    // Don't poison the cache on transient errors — let next call retry.
    throw new Error(`search.list HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        publishedAt?: string;
        channelTitle?: string;
        thumbnails?: {
          medium?: { url?: string };
          high?: { url?: string };
          default?: { url?: string };
        };
      };
    }>;
  };

  const videos: YtVideo[] = [];
  for (const item of body.items ?? []) {
    const id = item.id?.videoId;
    if (!id || !/^[\w-]{11}$/.test(id)) continue;
    const sn = item.snippet ?? {};
    videos.push({
      id,
      title: decodeEntities(sn.title ?? ""),
      publishedAt: sn.publishedAt ?? new Date().toISOString(),
      thumbnailUrl:
        sn.thumbnails?.medium?.url ??
        sn.thumbnails?.high?.url ??
        sn.thumbnails?.default?.url ??
        `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      channelName: sn.channelTitle ?? channelHandle,
      channelHandle,
      isLikeLive: true,
      embeddable: true,
      liveBroadcastContent: "live",
    });
  }

  // 3. Write through to both caches
  liveSearchCache.set(cacheKey, { videos, at: Date.now() });
  void writeSupabaseLiveCache(channelId, channelHandle, videos);
  return videos;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchYouTubeVideoMeta(
  videoIds: string[],
): Promise<Map<string, VideoEnrichment>> {
  const map = new Map<string, VideoEnrichment>();
  if (videoIds.length === 0) return map;

  const apiKey = process.env.YOUTUBE_API_KEY;
  const uniqueIds = [...new Set(videoIds)];

  if (apiKey) {
    const groups = chunk(uniqueIds, 50);
    for (const ids of groups) {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.searchParams.set("id", ids.join(","));
      url.searchParams.set("part", "snippet,status");
      url.searchParams.set("key", apiKey);

      try {
        const res = await fetch(url.toString(), {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          items?: Array<{
            id?: string;
            snippet?: { liveBroadcastContent?: LiveBroadcastContent };
            status?: { embeddable?: boolean };
          }>;
        };

        for (const item of body.items ?? []) {
          if (!item.id) continue;
          const embeddable = item.status?.embeddable !== false;
          const liveBroadcastContent = item.snippet?.liveBroadcastContent;
          map.set(item.id, { embeddable, liveBroadcastContent });
          oembedCache.set(item.id, { embeddable, at: Date.now() });
        }
      } catch {
        // Fall through to oEmbed fallback below.
      }
    }
  }

  const missing = uniqueIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    const fallback = await Promise.allSettled(missing.map((id) => fetchOEmbed(id)));
    fallback.forEach((result, i) => {
      const id = missing[i];
      if (result.status === "fulfilled") {
        map.set(id, result.value);
      } else {
        map.set(id, { embeddable: false });
      }
    });
  }

  return map;
}

/** Extract first {...} starting at startIdx, respecting quoted strings (JSON-ish). */
function sliceBalancedObject(html: string, startIdx: number): string | null {
  if (html[startIdx] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let q = "";
  for (let i = startIdx; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === q) {
        inStr = false;
        continue;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      q = c;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (depth === 0) return html.slice(startIdx, i + 1);
    }
  }
  return null;
}

function extractEmbeddedJson(
  html: string,
  markers: string[],
): unknown | null {
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;
    const braceStart = html.indexOf("{", idx + marker.length);
    if (braceStart === -1) continue;
    const jsonStr = sliceBalancedObject(html, braceStart);
    if (!jsonStr) continue;
    try {
      return JSON.parse(jsonStr) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}

function extractYtInitialPlayerResponse(html: string): unknown | null {
  return extractEmbeddedJson(html, [
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse = ",
    'window["ytInitialPlayerResponse"] = ',
    "window['ytInitialPlayerResponse'] = ",
    '"ytInitialPlayerResponse":',
  ]);
}

function extractYtInitialData(html: string): unknown | null {
  return extractEmbeddedJson(html, [
    "var ytInitialData = ",
    "ytInitialData = ",
    'window["ytInitialData"] = ',
    "window['ytInitialData'] = ",
  ]);
}

function extractLiveIdFromRawHtmlSignals(html: string): string | null {
  const primary = html.match(
    /"videoDetails"\s*:\s*\{[\s\S]{0,3000}?"videoId"\s*:\s*"([\w-]{11})"[\s\S]{0,3000}?"isLiveContent"\s*:\s*true/,
  );
  if (primary?.[1]) return primary[1];

  const fallback = html.match(
    /"isLiveContent"\s*:\s*true[\s\S]{0,2500}?"videoId"\s*:\s*"([\w-]{11})"/,
  );
  if (fallback?.[1]) return fallback[1];

  return null;
}

/**
 * DFS: find an object that carries both videoId and isLiveContent === true
 * (YouTube embeds this under videoDetails on watch pages).
 */
function findLiveVideoIdFromPlayerTree(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findLiveVideoIdFromPlayerTree(item);
      if (r) return r;
    }
    return null;
  }
  const o = obj as Record<string, unknown>;
  if (
    o.isLiveContent === true &&
    typeof o.videoId === "string" &&
    /^[\w-]{11}$/.test(o.videoId)
  ) {
    return o.videoId;
  }
  for (const k of Object.keys(o)) {
    const r = findLiveVideoIdFromPlayerTree(o[k]);
    if (r) return r;
  }
  return null;
}

function overlaysIndicateLive(overlays: unknown): boolean {
  if (!Array.isArray(overlays)) return false;
  const blob = JSON.stringify(overlays);
  return (
    /"style"\s*:\s*"LIVE"/.test(blob) ||
    (/thumbnailOverlayTimeStatusRenderer/.test(blob) && /\bLIVE\b/.test(blob))
  );
}

function badgesIndicateLive(badges: unknown): boolean {
  if (!Array.isArray(badges)) return false;
  const blob = JSON.stringify(badges);
  return (
    /BADGE_STYLE_TYPE_LIVE_NOW|BADGE_STYLE_TYPE_LIVE|"simpleText"\s*:\s*"LIVE"/.test(
      blob,
    )
  );
}

/**
 * Hub / browse JSON often exposes `videoRenderer` + LIVE badge without player blob.
 * Prefer badge/overlay signals over title text (titles still say "LIVE" on replays).
 */
function findLiveVideoIdFromInitialData(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findLiveVideoIdFromInitialData(item);
      if (r) return r;
    }
    return null;
  }
  const o = obj as Record<string, unknown>;
  const vid = o.videoId;
  if (
    typeof vid === "string" &&
    /^[\w-]{11}$/.test(vid) &&
    (overlaysIndicateLive(o.thumbnailOverlays) ||
      badgesIndicateLive(o.badges))
  ) {
    return vid;
  }
  for (const k of Object.keys(o)) {
    const r = findLiveVideoIdFromInitialData(o[k]);
    if (r) return r;
  }
  return null;
}

/** Resolve live id from a single HTML document (player JSON + browse JSON). */
function tryResolveLiveVideoIdFromHtml(html: string): {
  id: string | null;
  /** Player JSON carries `isLiveContent`; browse JSON only has badges — verify separately */
  source: "player" | "browse" | "none";
} {
  const player = extractYtInitialPlayerResponse(html);
  if (player) {
    const id = findLiveVideoIdFromPlayerTree(player);
    if (id) return { id, source: "player" };
  }
  const data = extractYtInitialData(html);
  if (data) {
    const id = findLiveVideoIdFromInitialData(data);
    if (id) return { id, source: "browse" };
  }
  const rawId = extractLiveIdFromRawHtmlSignals(html);
  if (rawId) return { id: rawId, source: "browse" };
  return { id: null, source: "none" };
}

async function verifyLiveViaWatchPlayer(videoId: string): Promise<boolean> {
  try {
    const watchRes = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      { headers: BROWSER_HEADERS, cache: "no-store", redirect: "follow" },
    );
    if (!watchRes.ok) return false;
    const html = await watchRes.text();
    const player = extractYtInitialPlayerResponse(html);
    if (!player) return false;
    const id = findLiveVideoIdFromPlayerTree(player);
    return id === videoId;
  } catch {
    return false;
  }
}

/**
 * No API key: hit /@handle/live (follows redirects). Parse ytInitialPlayerResponse
 * from HTML; only trust videoId when isLiveContent is true (avoids ended VOD).
 */
async function resolveLiveIdFromChannelPath(
  cleanHandle: string,
  path: "/live" | "/streams" | "/videos",
): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/@${cleanHandle}${path}`, {
    headers: BROWSER_HEADERS,
    cache: "no-store",
    redirect: "follow",
  });
  if (!res.ok) return null;

  let html = await res.text();
  let resolved = tryResolveLiveVideoIdFromHtml(html);
  let liveId = resolved.id;

  async function loadWatchPageHtml(videoId: string): Promise<void> {
    const watchRes = await fetch(
      `https://www.youtube.com/watch?v=${videoId}`,
      { headers: BROWSER_HEADERS, cache: "no-store", redirect: "follow" },
    );
    if (!watchRes.ok) return;
    html = await watchRes.text();
    resolved = tryResolveLiveVideoIdFromHtml(html);
    liveId = resolved.id ?? videoId;
  }

  // Channel pages may redirect to a watch URL; inspect it first.
  if (!liveId) {
    try {
      const redirected = new URL(res.url);
      const vParam = redirected.searchParams.get("v");
      if (vParam && /^[\w-]{11}$/.test(vParam)) {
        await loadWatchPageHtml(vParam);
      }
    } catch {
      /* ignore URL parse failures */
    }
  }

  // If still unresolved, try canonical watch href in HTML.
  if (!liveId) {
    const canonicalWatch = html.match(
      /<link[^>]+rel="canonical"[^>]+href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/i,
    );
    if (canonicalWatch?.[1]) {
      await loadWatchPageHtml(canonicalWatch[1]);
    }
  }

  if (liveId && resolved.source === "browse") {
    const isActuallyLive = await verifyLiveViaWatchPlayer(liveId);
    if (!isActuallyLive) return null;
  }
  return liveId;
}

async function fetchCurrentlyLiveVideoId(channelHandle: string): Promise<string | null> {
  const clean = channelHandle.replace(/^@/, "");
  const cached = livePageCache.get(clean);
  if (cached && Date.now() - cached.at < LIVE_PAGE_TTL) {
    return cached.videoId;
  }

  try {
    const probes: Array<"/live" | "/streams" | "/videos"> = [
      "/live",
      "/streams",
      "/videos",
    ];
    for (const probe of probes) {
      const liveId = await resolveLiveIdFromChannelPath(clean, probe);
      if (liveId) {
        livePageCache.set(clean, { videoId: liveId, at: Date.now() });
        return liveId;
      }
    }
    livePageCache.set(clean, { videoId: null, at: Date.now() });
    return null;
  } catch {
    livePageCache.set(clean, { videoId: null, at: Date.now() });
    return null;
  }
}

async function fetchOEmbedMeta(videoId: string): Promise<{
  title: string;
  thumbnailUrl: string;
} | null> {
  const url =
    "https://www.youtube.com/oembed?url=" +
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`) +
    "&format=json";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    title?: string;
    thumbnail_url?: string;
  };
  return {
    title: j.title ?? "Live",
    thumbnailUrl:
      j.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  if (!m) return undefined;
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const m = xml.match(
    new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"`, "i"),
  );
  return m ? m[1] : undefined;
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

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

/** Poll one channel (RSS + live discovery + enrichment). Used by cache refresh. */
export async function pollYoutubeChannel(handle: string): Promise<YtFeedResult> {
  const channelList = [handle.trim()].filter(Boolean);
  if (channelList.length === 0) {
    return { videos: [], errors: ["Missing channel handle"] };
  }

  const results = await Promise.allSettled(
    channelList.map((h) => fetchChannelFeed(h)),
  );

  const videos: YtVideo[] = [];
  const errors: string[] = [];
  const rssErrors: string[] = [];

  results.forEach((r, i) => {
    const label = normalizeHandle(channelList[i]);
    if (r.status === "fulfilled") {
      videos.push(...r.value);
    } else {
      rssErrors.push(`${label}: ${(r.reason as Error).message}`);
    }
  });

  const apiKey = process.env.YOUTUBE_API_KEY;
  const useDataApi = Boolean(apiKey);
  const cleanHandles = channelList.map((h) => normalizeHandle(h));
  const liveVideoIdByHandle = new Map<string, string>();
  const apiLiveVideos: YtVideo[] = [];

  if (useDataApi && apiKey) {
    // Discover ALL currently-live streams via search.list?eventType=live.
    // This is the only way to enumerate concurrent livestreams that may not
    // appear in the RSS upload feed.
    const liveSearchResults = await Promise.allSettled(
      cleanHandles.map(async (handle) => {
        const channelId = await resolveChannelId(handle);
        if (!channelId) return [] as YtVideo[];
        return searchLiveStreamsViaApi(apiKey, channelId, handle);
      }),
    );
    for (const result of liveSearchResults) {
      if (result.status === "fulfilled") {
        apiLiveVideos.push(...result.value);
      } else {
        errors.push(`live-search: ${(result.reason as Error).message}`);
      }
    }
  } else {
    // No Data API: detect actual live streams via /@handle/live +
    // ytInitialPlayerResponse (oEmbed cannot distinguish live vs replay; RSS
    // titles lie). Only resolves one stream per channel.
    const discovered = await Promise.all(
      cleanHandles.map(async (handle) => {
        const id = await fetchCurrentlyLiveVideoId(handle);
        return [handle, id] as const;
      }),
    );
    for (const [handle, id] of discovered) {
      if (id) liveVideoIdByHandle.set(handle, id);
    }
  }

  // Merge API-discovered live videos into the main list, preferring the
  // live entry when ids collide (RSS may include the same video as a recent
  // upload).
  const apiLiveIds = new Set(apiLiveVideos.map((v) => v.id));
  const mergedVideos: YtVideo[] = [
    ...apiLiveVideos,
    ...videos.filter((v) => !apiLiveIds.has(v.id)),
  ];

  const uniqueIds = [...new Set(mergedVideos.map((v) => v.id))];
  const scrapedLiveIds = !useDataApi ? [...liveVideoIdByHandle.values()] : [];
  const idsToEnrich = [
    ...new Set([
      ...mergedVideos.filter((v) => v.isLikeLive).map((v) => v.id),
      ...scrapedLiveIds,
      ...apiLiveIds,
    ]),
  ];

  const enrichment = await fetchYouTubeVideoMeta(idsToEnrich);
  let enrichedVideos = mergedVideos.map((video) => {
    const meta = enrichment.get(video.id);
    const isLiveFromSearch = apiLiveIds.has(video.id);
    const hasGroundTruth =
      meta && typeof meta.liveBroadcastContent === "string";

    // Liveness precedence:
    //   1. videos.list (1-quota, fresh per request) is the ground truth — if
    //      it says "none", a stale 60s-cached search.list hit must NOT keep
    //      the video flagged live.
    //   2. If videos.list didn't return data for this id (search-only entry,
    //      or quota error), fall back to the search.list signal.
    const isLikeLive = hasGroundTruth
      ? meta!.liveBroadcastContent === "live"
      : isLiveFromSearch;

    if (!meta) {
      return {
        ...video,
        isLikeLive,
      };
    }

    return {
      ...video,
      embeddable: meta.embeddable,
      liveBroadcastContent: meta.liveBroadcastContent,
      isLikeLive,
    };
  });

  if (!useDataApi) {
    enrichedVideos = enrichedVideos.map((video) => {
      const liveId = liveVideoIdByHandle.get(video.channelHandle);
      if (liveId && liveId === video.id) {
        const meta = enrichment.get(video.id);
        return {
          ...video,
          embeddable: meta?.embeddable !== false,
          liveBroadcastContent: "live",
          isLikeLive: true,
        };
      }
      return video;
    });

    for (const handle of cleanHandles) {
      const liveId = liveVideoIdByHandle.get(handle);
      if (!liveId) continue;
      const exists = enrichedVideos.some(
        (v) => v.channelHandle === handle && v.id === liveId,
      );
      if (exists) continue;
      const oembed = await fetchOEmbedMeta(liveId);
      const channelName =
        videos.find((v) => v.channelHandle === handle)?.channelName ?? handle;
      if (oembed) {
        enrichedVideos.push({
          id: liveId,
          title: oembed.title,
          publishedAt: new Date().toISOString(),
          thumbnailUrl: oembed.thumbnailUrl,
          channelName,
          channelHandle: handle,
          isLikeLive: true,
          embeddable: true,
          liveBroadcastContent: "live",
        });
      }
    }
  }

  enrichedVideos = enrichedVideos.map((video) => ({
    ...video,
    location: extractCctvLocation(video.title, video.id),
  }));

  enrichedVideos.sort((a, b) => {
    if (a.isLikeLive !== b.isLikeLive) return a.isLikeLive ? -1 : 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  if (enrichedVideos.length === 0) {
    errors.push(...rssErrors);
  }

  return { videos: enrichedVideos, errors };
}

/** Poll multiple channels and merge results (cron / dev fallback). */
export async function pollYoutubeChannels(handles: string[]): Promise<YtFeedResult> {
  const unique = [...new Set(handles.map(normalizeHandle).filter(Boolean))];
  if (unique.length === 0) return { videos: [], errors: [] };

  const parts = await Promise.all(unique.map((h) => pollYoutubeChannel(h)));
  const videos: YtVideo[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    errors.push(...part.errors);
    for (const v of part.videos) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      videos.push(v);
    }
  }

  videos.sort((a, b) => {
    if (a.isLikeLive !== b.isLikeLive) return a.isLikeLive ? -1 : 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return { videos, errors };
}
