import { jsonOkNoStore, jsonError } from "@/lib/api-response";

// Node.js runtime — avoids edge runtime fetch quirks in dev mode
export const dynamic = "force-dynamic";

export type YtVideo = {
  id: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  channelName: string;
  channelHandle: string;
  isLikeLive: boolean;
  embeddable?: boolean;
  liveBroadcastContent?: "live" | "upcoming" | "none";
};

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

type LiveBroadcastContent = "live" | "upcoming" | "none";

type VideoEnrichment = {
  embeddable: boolean;
  liveBroadcastContent?: LiveBroadcastContent;
};

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

  // Only read the first 64 KB — the <head> with the RSS link is always early
  const reader = res.body?.getReader();
  let html = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    while (bytes < 65_536) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.byteLength;
      // Stop early once we've found what we need
      if (html.includes("feeds/videos.xml")) break;
    }
    reader.cancel();
  } else {
    html = await res.text();
  }

  // YouTube includes:
  // <link rel="alternate" type="application/rss+xml"
  //       title="RSS" href="https://www.youtube.com/feeds/videos.xml?channel_id=UC...">
  const rssMatch = html.match(
    /href="(https:\/\/www\.youtube\.com\/feeds\/videos\.xml\?channel_id=[^"]+)"/,
  );
  if (rssMatch) {
    rssUrlCache.set(handle, rssMatch[1]);
    return rssMatch[1];
  }

  // Fallback: extract a channel_id from any embed in the page
  const idPatterns = [
    /"channelId"\s*:\s*"(UC[\w-]{20,})"/,
    /"externalChannelId"\s*:\s*"(UC[\w-]{20,})"/,
    /\/channel\/(UC[\w-]{20,})/,
  ];
  for (const pat of idPatterns) {
    const m = html.match(pat);
    if (m) {
      const rss = `https://www.youtube.com/feeds/videos.xml?channel_id=${m[1]}`;
      rssUrlCache.set(handle, rss);
      return rss;
    }
  }

  throw new Error(`RSS link not found in page source for @${handle}`);
}

async function fetchChannelFeed(handle: string): Promise<YtVideo[]> {
  const clean = handle.replace(/^@/, "");
  const rssUrl = await resolveRssUrl(clean);

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const handles = searchParams.get("channels");
  if (!handles) return jsonError("Missing ?channels= parameter", 400);

  const channelList = handles
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const results = await Promise.allSettled(
    channelList.map((h) => fetchChannelFeed(h)),
  );

  const videos: YtVideo[] = [];
  const errors: string[] = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      videos.push(...r.value);
    } else {
      errors.push(`${channelList[i]}: ${(r.reason as Error).message}`);
    }
  });

  const useDataApi = Boolean(process.env.YOUTUBE_API_KEY);
  const cleanHandles = channelList.map((h) => h.replace(/^@/, ""));
  const liveVideoIdByHandle = new Map<string, string>();

  // No Data API: detect actual live streams via /@handle/live + ytInitialPlayerResponse
  // (oEmbed cannot distinguish live vs replay; RSS titles lie.)
  if (!useDataApi) {
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

  const uniqueIds = [...new Set(videos.map((v) => v.id))];
  const scrapedLiveIds = !useDataApi ? [...liveVideoIdByHandle.values()] : [];
  const idsToEnrich = useDataApi
    ? uniqueIds
    : [
        ...new Set([
          ...videos.filter((v) => v.isLikeLive).map((v) => v.id),
          ...scrapedLiveIds,
        ]),
      ];

  const enrichment = await fetchYouTubeVideoMeta(idsToEnrich);
  let enrichedVideos = videos.map((video) => {
    const meta = enrichment.get(video.id);
    if (!meta) {
      return {
        ...video,
        isLikeLive: false,
      };
    }

    const hasGroundTruth = typeof meta.liveBroadcastContent === "string";
    const isLikeLive =
      hasGroundTruth && meta.liveBroadcastContent === "live";

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

  enrichedVideos.sort((a, b) => {
    if (a.isLikeLive !== b.isLikeLive) return a.isLikeLive ? -1 : 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return jsonOkNoStore({ videos: enrichedVideos, errors });
}
