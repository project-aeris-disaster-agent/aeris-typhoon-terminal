import { NextRequest, NextResponse } from "next/server";
import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { triageOneReport, triagePendingBatch } from "@/services/triage-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorizeInternal(req: NextRequest) {
  const secret = process.env.INTERNAL_TRIAGE_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("x-internal-triage-secret") === secret;
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
    const limit = Number(value.limit ?? 25);
    const results = await triagePendingBatch(
      Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 25,
    );
    return jsonOkNoStore({ ok: true, results, processed: results.length });
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
