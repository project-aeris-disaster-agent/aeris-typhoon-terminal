import {
  CHANNEL_FEED_CACHE_TTL_MS,
  CHANNEL_FEED_LOCK_MS,
} from "@/lib/youtube-feed/constants";
import type { ChannelCacheRow, YtFeedResult } from "@/lib/youtube-feed/types";

export function supabaseCacheConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function supabaseHeaders(serviceKey: string, extra?: Record<string, string>) {
  return {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
    ...extra,
  };
}

function parseRow(row: {
  channel_handle: string;
  videos: unknown;
  errors: unknown;
  fetched_at: string;
  expires_at: string;
  refreshing_until: string | null;
}): ChannelCacheRow {
  return {
    channel_handle: row.channel_handle,
    videos: Array.isArray(row.videos) ? (row.videos as ChannelCacheRow["videos"]) : [],
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
    refreshing_until: row.refreshing_until,
  };
}

export function isCacheFresh(row: ChannelCacheRow, now = Date.now()): boolean {
  // Empty feeds are never "fresh" — retry so RSS/API fixes can populate cache.
  if (row.videos.length === 0) return false;
  return new Date(row.expires_at).getTime() > now;
}

export function isLockHeld(row: ChannelCacheRow, now = Date.now()): boolean {
  if (!row.refreshing_until) return false;
  return new Date(row.refreshing_until).getTime() > now;
}

export async function readChannelCaches(
  handles: string[],
): Promise<Map<string, ChannelCacheRow>> {
  const cfg = supabaseCacheConfig();
  const map = new Map<string, ChannelCacheRow>();
  if (!cfg || handles.length === 0) return map;

  const params = new URLSearchParams({
    select:
      "channel_handle,videos,errors,fetched_at,expires_at,refreshing_until",
    channel_handle: `in.(${handles.join(",")})`,
  });

  try {
    const res = await fetch(
      `${cfg.url}/rest/v1/youtube_feed_channel_cache?${params}`,
      { headers: supabaseHeaders(cfg.serviceKey), cache: "no-store" },
    );
    if (!res.ok) return map;
    const rows = (await res.json()) as Array<{
      channel_handle: string;
      videos: unknown;
      errors: unknown;
      fetched_at: string;
      expires_at: string;
      refreshing_until: string | null;
    }>;
    for (const row of rows) {
      map.set(row.channel_handle, parseRow(row));
    }
  } catch {
    /* ignore */
  }
  return map;
}

function lockTimesMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) < 2000;
}

/** Try to become the single refresher for a stale/missing channel. */
export async function tryAcquireRefreshLock(handle: string): Promise<boolean> {
  const cfg = supabaseCacheConfig();
  if (!cfg) return true;

  const now = new Date().toISOString();
  const lockUntil = new Date(Date.now() + CHANNEL_FEED_LOCK_MS).toISOString();

  const staleParams = new URLSearchParams({
    channel_handle: `eq.${handle}`,
    or: `(expires_at.lt.${now},refreshing_until.lt.${now})`,
  });

  try {
    const patch = await fetch(
      `${cfg.url}/rest/v1/youtube_feed_channel_cache?${staleParams}`,
      {
        method: "PATCH",
        headers: supabaseHeaders(cfg.serviceKey, {
          prefer: "return=representation",
        }),
        body: JSON.stringify({ refreshing_until: lockUntil }),
      },
    );
    if (patch.ok) {
      const rows = (await patch.json()) as Array<{
        refreshing_until: string | null;
      }>;
      const row = rows[0];
      if (row && lockTimesMatch(row.refreshing_until, lockUntil)) return true;
    }
  } catch {
    /* fall through */
  }

  // No row yet — claim via upsert with lock (epoch expires_at = always stale)
  try {
    const expiresAt = new Date(0).toISOString();
    const res = await fetch(`${cfg.url}/rest/v1/youtube_feed_channel_cache`, {
      method: "POST",
      headers: supabaseHeaders(cfg.serviceKey, {
        prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify({
        channel_handle: handle,
        videos: [],
        errors: [],
        fetched_at: now,
        expires_at: expiresAt,
        refreshing_until: lockUntil,
      }),
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as Array<{ refreshing_until: string | null }>;
    const row = rows[0];
    return Boolean(row && lockTimesMatch(row.refreshing_until, lockUntil));
  } catch {
    return false;
  }
}

export async function writeChannelCache(
  handle: string,
  result: YtFeedResult,
): Promise<void> {
  const cfg = supabaseCacheConfig();
  if (!cfg) return;

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + CHANNEL_FEED_CACHE_TTL_MS,
  ).toISOString();

  try {
    await fetch(`${cfg.url}/rest/v1/youtube_feed_channel_cache`, {
      method: "POST",
      headers: supabaseHeaders(cfg.serviceKey, {
        prefer: "resolution=merge-duplicates",
      }),
      body: JSON.stringify({
        channel_handle: handle,
        videos: result.videos,
        errors: result.errors,
        fetched_at: now.toISOString(),
        expires_at: expiresAt,
        refreshing_until: null,
      }),
    });
  } catch {
    /* non-critical */
  }
}

export async function releaseRefreshLock(handle: string): Promise<void> {
  const cfg = supabaseCacheConfig();
  if (!cfg) return;

  const params = new URLSearchParams({ channel_handle: `eq.${handle}` });
  try {
    await fetch(
      `${cfg.url}/rest/v1/youtube_feed_channel_cache?${params}`,
      {
        method: "PATCH",
        headers: supabaseHeaders(cfg.serviceKey),
        body: JSON.stringify({ refreshing_until: null }),
      },
    );
  } catch {
    /* ignore */
  }
}
