import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { runStormWatchCycle } from "@/services/storm-watch-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorizeCron(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth === `Bearer ${cronSecret}`) return true;
  }

  const triageSecret = process.env.INTERNAL_TRIAGE_SECRET?.trim();
  if (triageSecret && request.headers.get("x-internal-triage-secret") === triageSecret) {
    return true;
  }

  return false;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const force =
    new URL(request.url).searchParams.get("force") === "true" ||
    new URL(request.url).searchParams.get("force") === "1";

  const result = await runStormWatchCycle({ force });
  return jsonOkNoStore(result);
}

export async function POST(request: Request) {
  return GET(request);
}
