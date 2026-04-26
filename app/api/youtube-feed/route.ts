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
const XML_TTL = 30_000;

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
    const hoursOld = (Date.now() - new Date(publishedAt).getTime()) / (1000 * 60 * 60);
    const isLikeLive = isLiveKeyword && hoursOld < 7 * 24; // 7 days for CCTV/webcams

    return {
      id: videoId,
      title,
      publishedAt,
      thumbnailUrl,
      channelName,
      channelHandle,
      isLikeLive,
    };
  });
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

  videos.sort((a, b) => {
    if (a.isLikeLive !== b.isLikeLive) return a.isLikeLive ? -1 : 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });

  return jsonOkNoStore({ videos, errors });
}
