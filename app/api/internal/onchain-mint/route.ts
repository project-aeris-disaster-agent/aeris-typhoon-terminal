/**
 * Internal mint trigger - dual-purpose:
 *
 * 1. PUSH PATH (Supabase Database Webhook):
 *    Supabase posts the row payload here as soon as a row's
 *    `onchain_mint_status` transitions to `queued`. We mint that single row
 *    immediately for near-realtime on-chain confirmation. Payload shape is
 *    Supabase's standard webhook envelope:
 *      {
 *        type: "UPDATE" | "INSERT",
 *        table: "disaster_reports",
 *        record: { id: string, onchain_mint_status: "queued", ... },
 *        old_record?: { ... },
 *        schema: "public"
 *      }
 *
 *    Alternative push shape (Postgres trigger via pg_net):
 *      { reportId: "uuid" }
 *
 * 2. BATCH PATH (manual / safety drain):
 *    POST with `{}` or `{ "limit": 5 }` runs the FIFO queue scan exactly
 *    like before. Used for backfills and operator debugging.
 *
 * Auth: Bearer ${INTERNAL_TRIAGE_SECRET}. The Supabase webhook configuration
 * sets the same Authorization header.
 */

import { NextResponse } from "next/server";
import {
  mintQueuedReports,
  mintReportById,
} from "@/services/onchain-mint-worker";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SupabaseWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
};

type SingleRowPayload = {
  reportId?: string;
};

type BatchPayload = {
  limit?: unknown;
  maxDurationMs?: unknown;
};

type AnyPayload = SupabaseWebhookPayload & SingleRowPayload & BatchPayload;

function extractTargetReportId(body: AnyPayload): string | null {
  // 1. Direct shape: { reportId }
  if (typeof body.reportId === "string" && body.reportId.length > 0) {
    return body.reportId;
  }
  // 2. Supabase webhook shape: look at record.id when transitioning to queued.
  if (body.record && typeof body.record === "object") {
    const record = body.record as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    const status =
      typeof record.onchain_mint_status === "string"
        ? record.onchain_mint_status
        : null;
    // Only act on rows currently queued; ignore other event types harmlessly.
    if (id && (status === "queued" || status === "minting")) {
      return id;
    }
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.INTERNAL_TRIAGE_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await rateLimit({
    key: `onchain-mint:${getClientIp(request)}`,
    // Push-path traffic from Supabase can spike when an operator verifies a
    // burst of reports - keep the bucket generous but bounded.
    max: 120,
    windowSeconds: 60,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many mint trigger requests." },
      { status: 429 },
    );
  }

  let body: AnyPayload = {};
  try {
    body = (await request.json()) as AnyPayload;
  } catch {
    // empty body is fine (treated as batch run with defaults)
  }

  // Push path - single report by id (Supabase webhook or pg_net trigger).
  const targetId = extractTargetReportId(body);
  if (targetId) {
    const outcome = await mintReportById(targetId);
    return NextResponse.json(
      { mode: "push", target: targetId, outcome },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Batch path - operator-triggered drain.
  const limitParam = Number(body.limit);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 50
      ? Math.floor(limitParam)
      : Number(process.env.ONCHAIN_MINT_BATCH_LIMIT ?? "5");

  const durationParam = Number(body.maxDurationMs);
  const durationMs =
    Number.isFinite(durationParam) && durationParam > 0 && durationParam <= 60_000
      ? Math.floor(durationParam)
      : (maxDuration - 5) * 1000;

  const summary = await mintQueuedReports({
    limit,
    deadlineAt: Date.now() + durationMs,
    safetyMarginMs: 7_000,
  });

  return NextResponse.json(
    { mode: "batch", ...summary },
    { headers: { "cache-control": "no-store" } },
  );
}
