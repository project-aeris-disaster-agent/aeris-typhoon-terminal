/**
 * Gamification: XP rewards, the level curve (0-99), and the server-side award
 * helper. The pure functions here are shared by client UI and server code, so
 * the level math stays identical to the SQL `aeris_level_from_xp` function.
 */

import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";

export type XpAction =
  | "submit_report"
  | "report_verified"
  | "review_report"
  | "vote_report"
  | "vote_correct"
  | "usage_time"
  | "profile_completed";

/** Default points per action. Keep in sync with docs/USER_PROFILE_GAMIFICATION.md. */
export const XP_REWARDS: Record<XpAction, number> = {
  submit_report: 15,
  report_verified: 40,
  review_report: 10,
  vote_report: 5,
  vote_correct: 15,
  usage_time: 5,
  profile_completed: 25,
};

export const MAX_LEVEL = 99;

/** Cumulative XP required to *reach* a given level. Mirrors the SQL curve. */
export function cumulativeXpForLevel(level: number): number {
  const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
  return 25 * l * (l + 1);
}

/** Highest level whose cumulative XP threshold is met by `xp`. */
export function levelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  let lvl = Math.floor((-1 + Math.sqrt(1 + (4 * xp) / 25)) / 2);
  if (lvl < 0) lvl = 0;
  while (cumulativeXpForLevel(lvl + 1) <= xp) lvl += 1;
  while (lvl > 0 && cumulativeXpForLevel(lvl) > xp) lvl -= 1;
  return Math.min(MAX_LEVEL, lvl);
}

export type LevelProgress = {
  level: number;
  /** XP accumulated within the current level. */
  xpIntoLevel: number;
  /** Total XP span of the current level. 0 at max level. */
  xpForNextLevel: number;
  /** Cumulative XP needed for the next level. */
  nextLevelXp: number;
  /** 0..1 progress toward the next level. 1 at max level. */
  ratio: number;
  isMax: boolean;
};

export function levelProgress(xp: number): LevelProgress {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = levelFromXp(safeXp);
  if (level >= MAX_LEVEL) {
    return {
      level: MAX_LEVEL,
      xpIntoLevel: 0,
      xpForNextLevel: 0,
      nextLevelXp: cumulativeXpForLevel(MAX_LEVEL),
      ratio: 1,
      isMax: true,
    };
  }
  const base = cumulativeXpForLevel(level);
  const next = cumulativeXpForLevel(level + 1);
  const span = next - base;
  const into = safeXp - base;
  return {
    level,
    xpIntoLevel: into,
    xpForNextLevel: span,
    nextLevelXp: next,
    ratio: span > 0 ? Math.max(0, Math.min(1, into / span)) : 0,
    isMax: false,
  };
}

export type AwardXpResult = {
  xp: number;
  level: number;
  leveledUp: boolean;
  awarded: boolean;
};

/**
 * Server-side: record an XP event and apply it via the `award_xp` RPC.
 * Idempotent when `dedupeKey` is supplied. Returns null when Supabase is not
 * configured or the call fails (callers treat awards as best-effort).
 */
export async function awardXp(
  userId: string,
  action: XpAction,
  opts?: { points?: number; refId?: string; dedupeKey?: string },
): Promise<AwardXpResult | null> {
  const cfg = supabaseRestConfig();
  if (!cfg || !userId) return null;

  const points = opts?.points ?? XP_REWARDS[action];

  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/award_xp`, {
      method: "POST",
      headers: serviceAuthHeaders(cfg.serviceKey),
      body: JSON.stringify({
        p_user_id: userId,
        p_action: action,
        p_points: points,
        p_dedupe_key: opts?.dedupeKey ?? null,
        p_ref_id: opts?.refId ?? null,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[gamification] award_xp failed ${res.status}: ${detail}`);
      return null;
    }

    const rows = (await res.json()) as Array<{
      xp: number;
      level: number;
      leveled_up: boolean;
      awarded: boolean;
    }>;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;
    return {
      xp: row.xp,
      level: row.level,
      leveledUp: row.leveled_up,
      awarded: row.awarded,
    };
  } catch (error) {
    console.error("[gamification] award_xp error", error);
    return null;
  }
}
