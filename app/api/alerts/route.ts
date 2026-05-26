import { jsonOk } from "@/lib/api-response";
import { buildAlertsFromGdacsRss } from "@/lib/gdacs-alerts";

// Node.js runtime — GDACS returns 403 from the Edge fetch layer in local dev.
export const runtime = "nodejs";
export const revalidate = 600;

export async function GET() {
  try {
    const alerts = await buildAlertsFromGdacsRss();
    return jsonOk({ alerts, error: null }, 600);
  } catch (e) {
    return jsonOk({ alerts: [], error: (e as Error).message }, 30);
  }
}
