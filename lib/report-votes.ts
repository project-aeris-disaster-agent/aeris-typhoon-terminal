/**
 * Community report votes (RLHF) — server-side data access.
 *
 * One row per (report, user) in aeris_report_votes; the table is service-role
 * only (like aeris_user_profiles / aeris_xp_events), so everything here runs
 * inside API routes. XP flows through the shared award_xp RPC via awardXp():
 * dedupe keys keep both the cast award and the correctness award idempotent.
 */

import { awardXp } from "@/lib/gamification";
import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";

export type ReportVoteValue = "up" | "down";

type VoteRow = {
  report_id: string;
  user_id: string;
  vote: number;
};

function toInt(vote: ReportVoteValue): number {
  return vote === "up" ? 1 : -1;
}

function toValue(vote: number): ReportVoteValue {
  return vote >= 0 ? "up" : "down";
}

export function reportVotesEnabled(): boolean {
  return supabaseRestConfig() !== null;
}

/** Insert or update the user's vote on a report. */
export async function upsertReportVote(
  reportId: string,
  userId: string,
  vote: ReportVoteValue,
): Promise<boolean> {
  const cfg = supabaseRestConfig();
  if (!cfg) return false;

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_report_votes?on_conflict=report_id,user_id`,
    {
      method: "POST",
      headers: {
        ...serviceAuthHeaders(cfg.serviceKey),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        report_id: reportId,
        user_id: userId,
        vote: toInt(vote),
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[report-votes] upsert failed ${res.status}: ${detail}`);
    return false;
  }
  return true;
}

/** All votes cast by a user, as a reportId -> "up" | "down" map. */
export async function getReportVotesByUser(
  userId: string,
): Promise<Record<string, ReportVoteValue>> {
  const cfg = supabaseRestConfig();
  if (!cfg) return {};

  const params = new URLSearchParams({
    select: "report_id,vote",
    user_id: `eq.${userId}`,
    order: "created_at.desc",
    limit: "1000",
  });

  const res = await fetch(`${cfg.url}/rest/v1/aeris_report_votes?${params}`, {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return {};

  const rows = (await res.json()) as VoteRow[];
  const votes: Record<string, ReportVoteValue> = {};
  for (const row of rows) votes[row.report_id] = toValue(row.vote);
  return votes;
}

/**
 * Settle votes after an admin decision: verify rewards thumbs-up voters,
 * reject rewards thumbs-down voters (`vote_correct` XP each). Idempotent per
 * (report, user) via the dedupe key, so flip-flop re-reviews (reject →
 * unverify → verify) can never award both directions twice — only the first
 * settlement per user pays out. Best-effort: failures are logged, never thrown,
 * so a settlement hiccup cannot fail the admin's review request.
 */
export async function settleReportVotes(
  reportId: string,
  outcome: "verified" | "rejected",
): Promise<number> {
  const cfg = supabaseRestConfig();
  if (!cfg) return 0;

  const winningVote = outcome === "verified" ? 1 : -1;
  let rows: VoteRow[] = [];
  try {
    const params = new URLSearchParams({
      select: "report_id,user_id,vote",
      report_id: `eq.${reportId}`,
      vote: `eq.${winningVote}`,
      limit: "1000",
    });
    const res = await fetch(`${cfg.url}/rest/v1/aeris_report_votes?${params}`, {
      headers: serviceAuthHeaders(cfg.serviceKey),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[report-votes] settle list failed ${res.status}: ${detail}`);
      return 0;
    }
    rows = (await res.json()) as VoteRow[];
  } catch (error) {
    console.error("[report-votes] settle list error", error);
    return 0;
  }

  let settled = 0;
  for (const row of rows) {
    const result = await awardXp(row.user_id, "vote_correct", {
      refId: reportId,
      dedupeKey: `vote_correct:${reportId}:${row.user_id}`,
    });
    if (result?.awarded) settled += 1;
  }
  return settled;
}
