import { jsonOk } from "@/lib/api-response";

export const runtime = "edge";
export const revalidate = 3600;

/**
 * PAGASA does not expose a stable public API or static SWB text in HTML.
 * Alerts feed uses GDACS for cyclone situation + hazard bulletins only.
 */
export async function GET() {
  return jsonOk({ alerts: [] }, 3600);
}
