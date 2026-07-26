/**
 * Safety-net cron for on-chain minting.
 *
 * The primary mint trigger is push-based: a Supabase Database Webhook (or
 * pg_net trigger) calls `/api/internal/onchain-mint` the moment a report's
 * `onchain_mint_status` flips to `queued`. That handles the happy path
 * within ~1 second.
 *
 * This cron exists to catch rows the push path missed - webhook delivery
 * failures, contract reverts, RPC blips - by sweeping rows that have been
 * queued for longer than `ONCHAIN_MINT_STALE_SECONDS` (default 120s). On
 * Vercel Hobby (one cron/day) this is a once-a-day audit; on paid plans
 * you can crank the schedule down to every 5-10 minutes for tighter SLA.
 */

import { authorizeCronRequest } from "@/lib/internal-auth";
import { NextResponse } from "next/server";
import { mintStaleQueuedReports } from "@/services/onchain-mint-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Secure-by-default: `authorizeCronRequest` fails closed when neither
 * CRON_SECRET nor INTERNAL_TRIAGE_SECRET is configured, so a misconfigured
 * deploy can never expose an open minting endpoint.
 */
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Number(process.env.ONCHAIN_MINT_BATCH_LIMIT ?? "10");
  const minAgeSeconds = Number(process.env.ONCHAIN_MINT_STALE_SECONDS ?? "120");
  const deadlineMs = (maxDuration - 5) * 1000;

  const summary = await mintStaleQueuedReports({
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
    deadlineAt: Date.now() + deadlineMs,
    safetyMarginMs: 7_000,
    minAgeSeconds: Number.isFinite(minAgeSeconds) && minAgeSeconds >= 0 ? minAgeSeconds : 120,
  });

  return NextResponse.json(
    { mode: "cron-sweep", minAgeSeconds, ...summary },
    { headers: { "cache-control": "no-store" } },
  );
}
