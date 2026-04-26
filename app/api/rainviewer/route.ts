import { jsonError, jsonOk } from "@/lib/api-response";
import { withBreaker } from "@/lib/circuit-breaker";

export const runtime = "edge";
export const revalidate = 300;

/**
 * Proxy for RainViewer public radar API. Returns the frame index for the
 * past 2 hours plus nowcast frames. Clients combine `host + path` to form
 * tile template URLs.
 */
export async function GET() {
  try {
    const data = await withBreaker(
      "rainviewer",
      async () => {
        const res = await fetch(
          "https://api.rainviewer.com/public/weather-maps.json",
          { next: { revalidate: 300 } },
        );
        if (!res.ok) throw new Error(`RainViewer ${res.status}`);
        return res.json();
      },
      { cooldownMs: 30_000 },
    );
    return jsonOk(data, 300);
  } catch (e) {
    return jsonError((e as Error).message, 502);
  }
}
