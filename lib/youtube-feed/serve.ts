import {
  CHANNEL_FEED_STALE_MAX_MS,
  MONITORED_YOUTUBE_HANDLES,
} from "@/lib/youtube-feed/constants";
import {
  isCacheFresh,
  isLockHeld,
  readChannelCaches,
  releaseRefreshLock,
  supabaseCacheConfig,
  tryAcquireRefreshLock,
  writeChannelCache,
} from "@/lib/youtube-feed/cache";
import { pollYoutubeChannel, pollYoutubeChannels } from "@/lib/youtube-feed/poll";
import type { ChannelCacheRow, YtFeedResult, YtVideo } from "@/lib/youtube-feed/types";

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

function rowToResult(row: ChannelCacheRow): YtFeedResult {
  return { videos: row.videos, errors: row.errors };
}

function isServeableStale(row: ChannelCacheRow, now = Date.now()): boolean {
  if (row.videos.length === 0) return false;
  const fetched = new Date(row.fetched_at).getTime();
  return now - fetched < CHANNEL_FEED_STALE_MAX_MS;
}

async function refreshChannelIfNeeded(
  handle: string,
  row: ChannelCacheRow | undefined,
  force: boolean,
): Promise<YtFeedResult | null> {
  const now = Date.now();
  if (!force && row && isCacheFresh(row, now)) {
    return rowToResult(row);
  }

  if (!force && row && isLockHeld(row, now)) {
    return isServeableStale(row, now) ? rowToResult(row) : null;
  }

  const acquired = await tryAcquireRefreshLock(handle);
  if (!acquired) {
    if (row && isServeableStale(row, now)) return rowToResult(row);
    return null;
  }

  try {
    const polled = await pollYoutubeChannel(handle);
    await writeChannelCache(handle, polled);
    return polled;
  } catch (e) {
    if (row && isServeableStale(row, now)) return rowToResult(row);
    return {
      videos: row?.videos ?? [],
      errors: [
        ...(row?.errors ?? []),
        `${handle}: ${(e as Error).message}`,
      ],
    };
  } finally {
    await releaseRefreshLock(handle);
  }
}

function mergeFeedResults(parts: YtFeedResult[]): YtFeedResult {
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

export type ServeYoutubeFeedOptions = {
  /** Ignore cache TTL (cron / manual refresh). */
  force?: boolean;
};

/**
 * Serve feed for requested channels using Supabase cache + single-writer refresh.
 * Without Supabase, polls YouTube directly (local dev).
 */
export async function serveYoutubeFeed(
  channelHandles: string[],
  options?: ServeYoutubeFeedOptions,
): Promise<YtFeedResult> {
  const handles = [
    ...new Set(channelHandles.map(normalizeHandle).filter(Boolean)),
  ];
  if (handles.length === 0) {
    return { videos: [], errors: ["No channels requested"] };
  }

  if (!supabaseCacheConfig()) {
    return pollYoutubeChannels(handles);
  }

  const force = options?.force === true;
  const cached = await readChannelCaches(handles);
  const parts: YtFeedResult[] = [];

  await Promise.all(
    handles.map(async (handle) => {
      const row = cached.get(handle);
      const result = await refreshChannelIfNeeded(handle, row, force);
      if (result) parts.push(result);
      else if (row && isServeableStale(row)) parts.push(rowToResult(row));
      else parts.push({ videos: [], errors: [`${handle}: feed unavailable`] });
    }),
  );

  return mergeFeedResults(parts);
}

/** Refresh all monitored channels (daily cron safety net). */
export async function refreshMonitoredYoutubeChannels(): Promise<YtFeedResult> {
  return serveYoutubeFeed([...MONITORED_YOUTUBE_HANDLES], { force: true });
}
