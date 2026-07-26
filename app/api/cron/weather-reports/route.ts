import { authorizeCronRequest } from "@/lib/internal-auth";
import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { runNationalWeatherReportCycle } from "@/services/weather-report-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const result = await runNationalWeatherReportCycle();
  return jsonOkNoStore({
    ok: true,
    ...result,
    checkedAt: new Date().toISOString(),
  });
}
