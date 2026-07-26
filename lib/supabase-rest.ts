/**
 * Shared Supabase PostgREST config + headers for server-side data access.
 *
 * This is the single source for "how do I talk to PostgREST from the server".
 * It previously coexisted with six inline re-implementations of the same two
 * functions (community-chat, youtube-feed/poll, youtube-feed/cache,
 * onchain/mint-queue, supabase-reports, supabase-agent); those all import from
 * here now.
 *
 * Server-side only: never import where SUPABASE_SERVICE_ROLE_KEY could be
 * bundled for the browser.
 */

export type SupabaseRestConfig = { url: string; serviceKey: string };

/**
 * Read/write config for tables accessed with the service role (bypasses RLS).
 * Returns null rather than throwing when the key is absent, so callers degrade
 * to a no-op instead of crashing an unconfigured local dev environment.
 */
export function supabaseRestConfig(): SupabaseRestConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

export type SupabaseRestReadConfig = {
  url: string;
  /** Service role key when available, otherwise the anon key. */
  key: string;
  /** True when `key` is the service role key (i.e. RLS is bypassed). */
  privileged: boolean;
};

/**
 * Config for read paths that still work with the anon key under RLS. Used by
 * modules that must keep serving public data on deploys where only the anon
 * key is configured.
 */
export function supabaseRestReadConfig(): SupabaseRestReadConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceKey || anonKey;
  if (!key) return null;
  return {
    url: url.replace(/\/$/, ""),
    key,
    privileged: Boolean(serviceKey),
  };
}

export function serviceAuthHeaders(
  key: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  };
}
