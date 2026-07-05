import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-response";
import { awardXp } from "@/lib/gamification";
import { rateLimit } from "@/lib/rate-limit";
import {
  reportVotesEnabled,
  upsertReportVote,
  type ReportVoteValue,
} from "@/lib/report-votes";
import { resolveSessionUserId } from "@/lib/session-user";
import { getSupabaseReportById } from "@/lib/supabase-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Statuses where the admin decision is already in — voting is closed. */
const DECIDED_STATUSES = new Set(["verified", "rejected", "duplicate"]);

/**
 * Community vote (RLHF) on a live report. Any signed-in user can vote
 * thumbs-up/down on an undecided report (except their own). Casting a vote
 * grants `vote_report` XP once per report; matching the eventual admin
 * decision grants `vote_correct` XP at review time (see the review route).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: reportId } = await context.params;
  if (!reportVotesEnabled()) {
    return jsonError("Report votes are not configured.", 503);
  }

  const userId = await resolveSessionUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  const limit = await rateLimit({
    key: `report-vote:${userId}`,
    max: 20,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError("Too many votes. Try again shortly.", 429, {
      resetSeconds: limit.resetSeconds,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const vote = (body as Record<string, unknown> | null)?.vote;
  if (vote !== "up" && vote !== "down") {
    return jsonError('Vote must be "up" or "down".', 400);
  }

  const report = await getSupabaseReportById(reportId);
  if (!report) return jsonError("Report not found.", 404);

  const status = report.verificationStatus ?? "unverified";
  if (DECIDED_STATUSES.has(status)) {
    return jsonError("This report has already been reviewed.", 409);
  }
  if (report.reporterUserId && report.reporterUserId === userId) {
    return jsonError("You cannot vote on your own report.", 403);
  }

  const saved = await upsertReportVote(reportId, userId, vote as ReportVoteValue);
  if (!saved) return jsonError("Failed to record vote.", 502);

  // One cast-award per (report, user): changing the vote later keeps the same
  // dedupe key, so it updates the row without re-awarding XP.
  const award = await awardXp(userId, "vote_report", {
    refId: reportId,
    dedupeKey: `vote_report:${reportId}:${userId}`,
  });

  return NextResponse.json(
    {
      vote,
      awarded: award?.awarded ?? false,
      xp: award?.xp ?? null,
      level: award?.level ?? null,
      leveledUp: award?.leveledUp ?? false,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
