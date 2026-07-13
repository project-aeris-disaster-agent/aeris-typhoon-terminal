import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import {
  notifyWatchOfficerDetailed,
  type TriageDigestItem,
  type WatchNotifyResult,
} from "@/lib/minds-watch-officer";
import { triagePendingBatchDetailed } from "@/services/triage-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Vercel Hobby caps serverless functions at ~10 seconds; this literal mirrors
 * that ceiling so the route runs unchanged on free tier. Next.js requires
 * `maxDuration` to be a static numeric literal, so on Pro/Enterprise raise it
 * by editing this constant (e.g. 60). The per-invocation workload is also
 * bounded by `TRIAGE_CRON_BATCH_SIZE` and the deadline budget below.
 */
export const maxDuration = 10;

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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const startedAt = Date.now();
  /**
   * Default batch size is tuned for Hobby (5 reports x ~1.5s each fits in 10s
   * even when the LLM is slow). Override with `TRIAGE_CRON_BATCH_SIZE` on Pro.
   */
  const limit = parsePositiveInt(process.env.TRIAGE_CRON_BATCH_SIZE, 5);
  const safetyMarginMs = parsePositiveInt(process.env.TRIAGE_CRON_SAFETY_MS, 1500);
  const deadlineAt = startedAt + (maxDuration * 1000) - safetyMarginMs;

  const summary = await triagePendingBatchDetailed({
    limit,
    deadlineAt,
    safetyMarginMs,
  });

  const triageDigestItems: TriageDigestItem[] = summary.results
    .filter((row) => row.triaged && row.result)
    .map((row) => ({
      reportId: row.reportId,
      category: row.category ?? "unknown",
      description: row.description ?? "",
      priority: row.result!.priority,
      rationale: row.result!.rationale,
      confidence: row.result!.confidence,
    }));

  // Confirmed delivery only if it fits the remaining duration budget.
  const replyBudgetMs = Math.max(0, deadlineAt - Date.now());
  const minds: WatchNotifyResult = await notifyWatchOfficerDetailed(
    { kind: "triage_batch", items: triageDigestItems },
    { replyTimeoutMs: replyBudgetMs },
  ).catch((error) => {
    console.error(
      `[minds-watch] triage notify failed: ${(error as Error).message}`,
    );
    return { notified: false, critical: false, confirmed: null };
  });

  const elapsedMs = Date.now() - startedAt;
  return jsonOkNoStore({
    ok: true,
    processed: summary.results.length,
    triaged: summary.results.filter((r) => r.triaged).length,
    autoRejected: summary.results.filter((r) => r.autoRejected).length,
    urgent: summary.results.filter((r) => r.result?.priority === "urgent").length,
    broadcasted: summary.results.filter((r) => r.broadcasted).length,
    stoppedEarly: summary.stoppedEarly,
    remaining: summary.remaining,
    mindsNotified: minds.notified,
    mindsConfirmed: minds.confirmed,
    elapsedMs,
    limit,
    maxDuration,
    checkedAt: new Date().toISOString(),
  });
}
