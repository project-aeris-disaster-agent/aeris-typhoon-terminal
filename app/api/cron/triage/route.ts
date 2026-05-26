import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { triagePendingBatch } from "@/services/triage-runner";

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

  const results = await triagePendingBatch(25);
  return jsonOkNoStore({
    ok: true,
    processed: results.length,
    triaged: results.filter((r) => r.triaged).length,
    autoRejected: results.filter((r) => r.autoRejected).length,
    checkedAt: new Date().toISOString(),
  });
}
