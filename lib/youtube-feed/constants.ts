/** Single source of truth for YouTube channel handles (no leading @). */
export const YOUTUBE_NEWS_HANDLES = [
  "gmanews2026",
  "abscbnnews",
  "OneNewsPH",
] as const;

export const YOUTUBE_WEBCAM_HANDLE = "JazBazPhilippines" as const;

/** All channels refreshed by cron and eligible for Supabase cache. */
export const MONITORED_YOUTUBE_HANDLES = [
  ...YOUTUBE_NEWS_HANDLES,
  YOUTUBE_WEBCAM_HANDLE,
] as const;

export const NEWS_CHANNEL_HANDLES = new Set<string>(YOUTUBE_NEWS_HANDLES);

export const JAZBAZ_CHANNEL_HANDLE = YOUTUBE_WEBCAM_HANDLE;

/** Client API query list (with @ prefix). */
export const YOUTUBE_FEED_CHANNELS = MONITORED_YOUTUBE_HANDLES.map(
  (h) => `@${h}`,
);

/** How long a cached channel feed is considered fresh. */
export const CHANNEL_FEED_CACHE_TTL_MS = 10 * 60 * 1000;

/** Lock duration while one worker refreshes a channel (prevents duplicate YouTube calls). */
export const CHANNEL_FEED_LOCK_MS = 2 * 60 * 1000;

/** Serve very stale cache up to this age when refresh is locked or fails. */
export const CHANNEL_FEED_STALE_MAX_MS = 24 * 60 * 60 * 1000;

/** Edge cache for read API responses (seconds). */
export const YOUTUBE_FEED_EDGE_CACHE_SECONDS = 60;
