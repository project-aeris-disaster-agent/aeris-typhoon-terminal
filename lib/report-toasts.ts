import type { IncidentReport } from "@/services/reports-client";

/**
 * Decide which reports deserve a toast on this poll.
 *
 * - The first poll only records what already exists (`seen === null`): opening
 *   the dashboard must not fire a toast for every urgent report in the backlog.
 * - After that, a toast is raised for each report that is new since the last
 *   poll AND triaged urgent. Everything else waits in the Live Reports list.
 *
 * - An empty first poll is not a baseline: the feed can blip empty during a
 *   backend fallback, and treating that as "nothing exists yet" would toast the
 *   whole urgent backlog on the next poll. The seen-set stays `null` until a
 *   non-empty list arrives.
 *
 * Returns the updated seen-set (never mutates the one passed in).
 */
export function pickToastReports(
  seen: ReadonlySet<string> | null,
  reports: readonly IncidentReport[],
): { seen: Set<string> | null; fresh: IncidentReport[] } {
  if (seen === null && reports.length === 0) return { seen: null, fresh: [] };
  const next = new Set(seen ?? []);
  const fresh: IncidentReport[] = [];
  for (const r of reports) {
    if (seen !== null && !seen.has(r.id) && r.aiPriority === "urgent") {
      fresh.push(r);
    }
    next.add(r.id);
  }
  // Newest first, so the top toast is the latest call for help.
  fresh.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { seen: next, fresh };
}
