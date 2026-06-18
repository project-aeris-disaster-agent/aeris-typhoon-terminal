import { jsonError } from "@/lib/api-response";

export const runtime = "nodejs";

/**
 * Same-origin proxy for official PAGASA Tropical Cyclone Bulletin PDFs.
 *
 * The bulletins live on `pubfiles.pagasa.dost.gov.ph`. Linking out forced a
 * new browser tab; to host the PDF inside an in-app popup we stream it through
 * this route so it is same-origin (no cross-origin frame / `X-Frame-Options`
 * surprises) and is served with `Content-Disposition: inline` so browsers
 * render it instead of downloading.
 *
 * The upstream host is allow-listed (not taken freely from the request) so this
 * cannot be abused as an open proxy. Anything else yields a 400/502 and the
 * caller falls back to the official "open in new tab" link.
 */
const ALLOWED_HOSTS = new Set(["pubfiles.pagasa.dost.gov.ph"]);

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return jsonError("Missing url", 400);

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return jsonError("Invalid url", 400);
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return jsonError("Host not allowed", 400);
  }
  if (!target.pathname.toLowerCase().endsWith(".pdf")) {
    return jsonError("Not a PDF", 400);
  }

  try {
    const res = await fetch(target.toString(), {
      headers: {
        "user-agent":
          "AERIS-Dashboard/1.0 (+disaster-resilience; contact via repo)",
        accept: "application/pdf",
      },
      // Bulletins are reissued under the same name; let the CDN absorb repeats
      // but keep it short so a new bulletin number is picked up promptly.
      next: { revalidate: 300 },
    });

    if (!res.ok || !res.body) {
      return jsonError(`PAGASA PDF ${res.status}`, 502);
    }

    return new Response(res.body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "inline",
        "cache-control":
          "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (e) {
    return jsonError((e as Error).message || "PAGASA PDF fetch failed", 502);
  }
}
