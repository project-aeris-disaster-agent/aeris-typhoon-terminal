/**
 * Path classification for the session gate in `middleware.ts`.
 *
 * Lives outside middleware so it can be unit-tested: middleware itself pulls in
 * the Privy JWT stack and the Supabase SSR client, which makes it awkward to
 * exercise, and these two predicates decide whether a request is authenticated
 * at all. They are the control, so they get tests.
 *
 * Edge-safe: no imports, no Node APIs.
 */

/**
 * Paths that skip the session gate. Everything here must carry its own guard:
 * `/api/cron` and `/api/internal` authenticate with an operator secret (see
 * lib/internal-auth.ts, lib/minds-auth.ts), `/api/health` is deliberately
 * anonymous for uptime probes, and the rest are the login surfaces themselves.
 *
 * `/api/geocode` used to be here. Its only callers are components/MapSearchBar
 * and lib/resolve-user-location, both of which run on the authenticated
 * dashboard — so the exemption bought nothing and left an open Nominatim /
 * Photon proxy whose per-IP limiter degrades to per-instance counters whenever
 * KV is unprovisioned. Abuse there gets our egress IP banned by OSM, which
 * takes location search down exactly when it is needed.
 */
export const PUBLIC_PATHS = [
  "/login",
  "/refresh",
  "/api/auth",
  "/api/health",
  "/api/cron",
  "/api/internal",
  "/auth",
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** File extensions served from `public/` that the session gate should skip. */
const STATIC_ASSET_SUFFIXES = [
  ".ico",
  ".svg",
  ".json",
  ".js",
  ".css",
  ".webp",
  ".png",
  ".vrm",
  ".gri",
  ".gif",
];

/**
 * Static assets under `public/`, matched by extension.
 *
 * The extension test is **never** applied to `/api/`. Next.js routes by
 * filesystem, so a suffix-based auth exemption sitting in front of that router
 * is a standing hazard: any future dynamic route whose last segment can end in
 * `.json` (an export endpoint, a catch-all proxy, an `[id]` that accepts a
 * filename) would become unauthenticated silently, with nothing in the route
 * file to hint at it. No route matches today — the only catch-all,
 * /api/rainviewer/tiles/[...path], is a hardcoded-origin tile proxy — but
 * "no route matches today" is not a control.
 *
 * The `matcher` in middleware.ts also keeps the known asset directories out of
 * middleware entirely, so this is the second layer, not the only one.
 */
export function isStaticAssetPath(pathname: string): boolean {
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return true;
  }
  if (pathname.startsWith("/api/")) return false;
  return STATIC_ASSET_SUFFIXES.some((suffix) => pathname.endsWith(suffix));
}
