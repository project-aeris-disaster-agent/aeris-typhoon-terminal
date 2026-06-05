export const runtime = "edge";

/**
 * Same-origin proxy for RainViewer radar/satellite PNG tiles.
 *
 * MapLibre fetched tiles directly from `tilecache.rainviewer.com`, which
 * rate-limits the free public endpoint (HTTP 429). Error responses carry no
 * CORS header, so the browser reported them as CORS failures. Routing tiles
 * through this edge route makes them same-origin and lets the CDN cache absorb
 * repeat hits, cutting upstream calls so the rate limit is no longer tripped.
 *
 * The upstream host is hardcoded (not taken from the request) so this cannot be
 * abused as an open proxy.
 */
const UPSTREAM_ORIGIN = "https://tilecache.rainviewer.com";

/** 1×1 fully transparent PNG, served when a frame's tiles have expired. */
const TRANSPARENT_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/**
 * RainViewer drops radar frames older than its retention window, so once-valid
 * tile paths start returning non-OK responses. Returning a transparent tile
 * (instead of a 502) keeps the animation clean — the frame simply renders empty
 * rather than leaving broken/holey cells on the map. A short cache lets the tile
 * recover automatically if the frame becomes valid again.
 */
function transparentTile() {
  return new Response(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=60",
    },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const tilePath = (path ?? []).join("/");

  if (!tilePath || !tilePath.endsWith(".png")) {
    return new Response("Not found", { status: 404 });
  }

  const upstream = `${UPSTREAM_ORIGIN}/${tilePath}`;

  try {
    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok) {
      return transparentTile();
    }
    // Tiles for a given timestamp are immutable, so cache aggressively at the
    // CDN while keeping the browser copy short-lived.
    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "image/png",
        "cache-control":
          "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400",
      },
    });
  } catch {
    return transparentTile();
  }
}
