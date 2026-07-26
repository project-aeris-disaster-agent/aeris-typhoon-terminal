import { authorizeCronRequest } from "@/lib/internal-auth";
import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { runStormWatchCycle } from "@/services/storm-watch-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
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
