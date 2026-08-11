/**
 * Community report votes (RLHF) — server-side data access.
 *
 * One row per (report, user) in aeris_report_votes; the table is service-role
 * only (like aeris_user_profiles / aeris_xp_events), so everything here runs
 * inside API routes. XP flows through the shared award_xp RPC via awardXp():
 * dedupe keys keep both the cast award and the correctness award idempotent.
 */

import { awardXp, XP_REWARDS } from "@/lib/gamification";
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

  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/settle_report_votes`, {
      method: "POST",
      headers: serviceAuthHeaders(cfg.serviceKey),
      body: JSON.stringify({
        p_report_id: reportId,
        p_outcome: outcome,
        p_points: XP_REWARDS.vote_correct,
      }),
      cache: "no-store",
    });

    if (res.ok) {
      const body = (await res.json()) as
        | Array<{ settled?: number }>
        | { settled?: number }
        | number
        | null;
      if (typeof body === "number") return body;
      const row = Array.isArray(body) ? body[0] : body;
      return row?.settled ?? 0;
    }

    const detail = await res.text().catch(() => "");
    // PGRST202 = "function not found". Distinguish it loudly: it means the
    // migration has not been applied yet, which is a deploy-ordering problem
    // with a known fix, not a runtime fault.
    if (res.status === 404 || detail.includes("PGRST202")) {
      console.error(
        "[report-votes] settle_report_votes RPC is missing — apply " +
          "supabase/migrations/20260810140000_settle_report_votes_rpc.sql. " +
          "Falling back to the per-voter loop for now.",
      );
      return settleReportVotesPerVoter(reportId, outcome);
    }

    console.error(`[report-votes] settle rpc failed ${res.status}: ${detail}`);
    return 0;
  } catch (error) {
    console.error("[report-votes] settle rpc error", error);
    return 0;
  }
}

/**
 * Pre-RPC settlement path: one award_xp HTTP call per winning voter.
 *
 * Kept only to cover the window between deploying this code and applying the
 * migration, so no voter silently loses XP in between. **Delete this once the
 * RPC is live** — it is the thing the RPC exists to replace, and on a
 * well-voted report it is what fails the operator's review request.
 *
 * Bounded concurrency and a hard cap keep the blast radius small if it does
 * run; anything beyond the cap is logged rather than dropped silently.
 */
const FALLBACK_MAX_VOTERS = 200;
const FALLBACK_CONCURRENCY = 8;

async function settleReportVotesPerVoter(
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
      limit: String(FALLBACK_MAX_VOTERS + 1),
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

  if (rows.length > FALLBACK_MAX_VOTERS) {
    console.error(
      `[report-votes] report ${reportId} has more than ${FALLBACK_MAX_VOTERS} ` +
        `winning voters; settling the first ${FALLBACK_MAX_VOTERS} only. Apply ` +
        "the settle_report_votes migration to settle all of them in one call.",
    );
    rows = rows.slice(0, FALLBACK_MAX_VOTERS);
  }

  let settled = 0;
  for (let i = 0; i < rows.length; i += FALLBACK_CONCURRENCY) {
    const batch = rows.slice(i, i + FALLBACK_CONCURRENCY);
    const results = await Promise.all(
      batch.map((row) =>
        awardXp(row.user_id, "vote_correct", {
          refId: reportId,
          dedupeKey: `vote_correct:${reportId}:${row.user_id}`,
        }),
      ),
    );
    settled += results.filter((result) => result?.awarded).length;
  }
  return settled;
}
