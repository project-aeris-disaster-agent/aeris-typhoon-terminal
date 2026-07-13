/**
 * Presentation-layer staleness filter for the PAGASA bulletin panel.
 *
 * The upstream index (pagasa-parser) exposes no per-bulletin issuance date and
 * frequently keeps dissipated/exited cyclones listed as non-`final`. The
 * primary fix is the official SWB quiet-PAR gate in lib/pagasa-bulletins.ts.
 * This filter is the backup when that probe fails: storm-watch cycle
 * `updated_at` advances only when a bulletin number moves, so "no advance in
 * N days" is a proxy for "dissipated".
 *
 * Applied only on /api/pagasa-bulletins (and skipped when the payload is
 * already quiet). Storm-watch email detection uses the shared fetch path,
 * which already clears on quiet PAR.
 */

import type { PagasaBulletin, PagasaBulletins } from "@/lib/pagasa-bulletins";
import { cycloneSlug, type StormWatchCycleRow } from "@/lib/storm-watch/types";

export const DEFAULT_STALE_DAYS = 3;

export function bulletinStaleDays(): number {
  const raw = Number(process.env.PAGASA_BULLETIN_STALE_DAYS ?? DEFAULT_STALE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_DAYS;
}

/**
 * True when a bulletin represents a system the parser still lists but which has
 * not advanced in `staleDays`. Fails open (returns false) whenever we lack the
 * history to judge, so a genuinely active bulletin is never hidden by mistake.
 */
export function isBulletinStale(
  bulletin: PagasaBulletin,
  cyclesBySlug: Map<string, StormWatchCycleRow>,
  nowMs: number,
  staleDays: number,
): boolean {
  const cycle = cyclesBySlug.get(cycloneSlug(bulletin.name));
  // No recorded history → cannot judge age; keep showing it.
  if (!cycle) return false;
  // Parser is ahead of what we last recorded → a fresh advance; keep.
  if (bulletin.number > cycle.last_bulletin_number) return false;
  const updatedMs = new Date(cycle.updated_at).getTime();
  if (!Number.isFinite(updatedMs)) return false;
  return nowMs - updatedMs > staleDays * 24 * 60 * 60 * 1000;
}

/**
 * Drop bulletins whose cyclone has gone stale per the cycle history, recomputing
 * `hasActive` from the survivors. Returns the original object unchanged when
 * nothing is filtered so callers can cheaply detect a no-op.
 */
export function filterStaleBulletins(
  payload: PagasaBulletins,
  cycles: StormWatchCycleRow[],
  opts?: { nowMs?: number; staleDays?: number },
): PagasaBulletins {
  const nowMs = opts?.nowMs ?? Date.now();
  const staleDays = opts?.staleDays ?? bulletinStaleDays();
  const cyclesBySlug = new Map(cycles.map((c) => [c.cyclone_slug, c]));

  const kept = payload.bulletins.filter(
    (b) => !isBulletinStale(b, cyclesBySlug, nowMs, staleDays),
  );
  if (kept.length === payload.bulletins.length) return payload;

  return {
    ...payload,
    bulletins: kept,
    hasActive: kept.some((b) => !b.final),
  };
}
