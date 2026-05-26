import { jsonOk } from "@/lib/api-response";
import { buildAlertsFromGdacsRss } from "@/lib/gdacs-alerts";

export const runtime = "nodejs";
export const revalidate = 600;

/** @deprecated Prefer /api/alerts — kept for direct hazard-only consumers. */
export async function GET() {
  try {
    const alerts = await buildAlertsFromGdacsRss();
    const hazards = alerts.filter((a) => !a.id.startsWith("tc-"));
    return jsonOk({ alerts: hazards }, 600);
  } catch (e) {
    return jsonOk({ alerts: [], _error: (e as Error).message }, 30);
  }
}
