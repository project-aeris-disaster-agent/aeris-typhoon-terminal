import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { runNationalWeatherReportCycle } from "@/services/weather-report-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const result = await runNationalWeatherReportCycle();
  return jsonOkNoStore({
    ok: true,
    ...result,
    checkedAt: new Date().toISOString(),
  });
}
