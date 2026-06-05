import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";
import { authorizeReportReview } from "@/lib/review-auth";
import {
  countVerifiedPendingMint,
  queueVerifiedReportsForMint,
} from "@/lib/onchain/mint-queue";
import { mintQueuedReports } from "@/services/onchain-mint-worker";
import { supabaseServiceRoleEnabled } from "@/lib/supabase-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type MintBody = {
  limit?: unknown;
  maxDurationMs?: unknown;
};

export async function POST(req: NextRequest) {
  if (!supabaseServiceRoleEnabled()) {
    return jsonError(
      "Bulk mint requires SUPABASE_SERVICE_ROLE_KEY with role service_role.",
      503,
    );
  }

  const auth = await authorizeReportReview(req, "human_operator");
  if (!auth.ok) return jsonError(auth.error, auth.status);

  let body: MintBody = {};
  try {
    body = (await req.json()) as MintBody;
  } catch {
    // defaults are fine
  }

  const limitParam = Number(body.limit);
  const batchLimit =
    Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 50
      ? Math.floor(limitParam)
      : Number(process.env.ONCHAIN_MINT_BATCH_LIMIT ?? "10");

  const durationParam = Number(body.maxDurationMs);
  const durationMs =
    Number.isFinite(durationParam) && durationParam > 0 && durationParam <= 60_000
      ? Math.floor(durationParam)
      : (maxDuration - 5) * 1000;

  const deadlineAt = Date.now() + durationMs;
  const pendingBefore = await countVerifiedPendingMint();
  const newlyQueued = await queueVerifiedReportsForMint();

  const summaries = [];
  let reachedDeadline = false;
  const maxPasses = 20;

  for (let pass = 0; pass < maxPasses && Date.now() + 7_000 < deadlineAt; pass += 1) {
    const summary = await mintQueuedReports({
      limit: batchLimit,
      deadlineAt,
      safetyMarginMs: 7_000,
    });
    summaries.push(summary);
    if (summary.reachedDeadline) {
      reachedDeadline = true;
      break;
    }
    if (summary.attempted === 0) break;
  }

  const attempted = summaries.reduce((sum, item) => sum + item.attempted, 0);
  const results = summaries.flatMap((item) => item.results);
  const minted = results.filter(
    (item) => item.status === "minted" || item.status === "already_minted",
  ).length;
  const failed = results.filter((item) => item.status === "failed").length;
  const pendingAfter = await countVerifiedPendingMint();

  return NextResponse.json(
    {
      pendingBefore,
      newlyQueued,
      attempted,
      minted,
      failed,
      pendingAfter,
      reachedDeadline,
      results,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
