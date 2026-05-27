import { jsonOkNoStore } from "@/lib/api-response";
import { buildAlertsFromGdacsRss } from "@/lib/gdacs-alerts";

// Node.js runtime — GDACS returns 403 from the Edge fetch layer in local dev.
export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  try {
    const alerts = await buildAlertsFromGdacsRss();
    return jsonOkNoStore({ alerts, error: null });
  } catch (e) {
    return jsonOkNoStore({ alerts: [], error: (e as Error).message });
  }
}
