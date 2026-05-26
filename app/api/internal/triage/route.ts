import { NextRequest } from "next/server";
import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { triageOneReport, triagePendingBatchDetailed } from "@/services/triage-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Same envelope as the cron route. Vercel Hobby caps functions at ~10 seconds;
 * Next.js requires `maxDuration` to be a static literal, so raise this manually
 * on Pro/Enterprise. Per-invocation workload is bounded by `TRIAGE_CRON_BATCH_SIZE`
 * and the deadline computed below from this constant.
 */
export const maxDuration = 10;

function authorizeInternal(req: NextRequest) {
  const secret = process.env.INTERNAL_TRIAGE_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("x-internal-triage-secret") === secret;
}

function clampLimit(raw: unknown, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function POST(req: NextRequest) {
  if (!authorizeInternal(req)) {
    return jsonError("Unauthorized.", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (value.batch === true) {
    const startedAt = Date.now();
    const defaultBatch = parsePositiveInt(process.env.TRIAGE_CRON_BATCH_SIZE, 5);
    const limit = clampLimit(value.limit, defaultBatch);
    const safetyMarginMs = parsePositiveInt(process.env.TRIAGE_CRON_SAFETY_MS, 1500);
    const deadlineAt = startedAt + maxDuration * 1000 - safetyMarginMs;

    const summary = await triagePendingBatchDetailed({
      limit,
      deadlineAt,
      safetyMarginMs,
    });

    return jsonOkNoStore({
      ok: true,
      results: summary.results,
      processed: summary.results.length,
      stoppedEarly: summary.stoppedEarly,
      remaining: summary.remaining,
      elapsedMs: Date.now() - startedAt,
      limit,
      maxDuration,
    });
  }

  const reportId = typeof value.reportId === "string" ? value.reportId : "";
  if (!reportId) {
    return jsonError("reportId is required unless batch=true.", 400);
  }

  const result = await triageOneReport(reportId);
  if (!result.triaged && result.error === "Report not found.") {
    return jsonError(result.error, 404);
  }

  return jsonOkNoStore({ ok: true, result });
}
