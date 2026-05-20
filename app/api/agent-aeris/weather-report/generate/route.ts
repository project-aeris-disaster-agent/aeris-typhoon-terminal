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

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return jsonError("Unauthorized.", 401);
  }

  let forceDaily = false;
  let forceBreaking = false;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    forceDaily = body.forceDaily === true;
    forceBreaking = body.forceBreaking === true;
  }

  const result = await runNationalWeatherReportCycle({ forceDaily, forceBreaking });
  return jsonOkNoStore(result);
}
