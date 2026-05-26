import { jsonError, jsonOk } from "@/lib/api-response";
import { YOUTUBE_FEED_EDGE_CACHE_SECONDS } from "@/lib/youtube-feed/constants";
import { serveYoutubeFeed } from "@/lib/youtube-feed/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { YtVideo } from "@/lib/youtube-feed/types";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const handles = searchParams.get("channels");
  if (!handles) return jsonError("Missing ?channels= parameter", 400);

  const channelList = handles
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  const result = await serveYoutubeFeed(channelList);
  return jsonOk(result, YOUTUBE_FEED_EDGE_CACHE_SECONDS);
}
