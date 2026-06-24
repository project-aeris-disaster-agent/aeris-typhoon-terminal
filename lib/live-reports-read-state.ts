import type { IncidentReport } from "@/services/reports-client";

const STORAGE_KEY = "aeris:live-reports-last-seen-at";

export function readLastSeenAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastSeenAt(iso: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, iso);
  } catch {
    /* localStorage may be disabled in private mode */
  }
}

export function countUnreadReports(
  reports: IncidentReport[],
  lastSeenAt: string | null,
): number {
  if (!lastSeenAt) return reports.length;
  const seenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(seenMs)) return reports.length;
  return reports.filter((report) => Date.parse(report.createdAt) > seenMs).length;
}

/** Mark every report currently in the feed as seen. */
export function markReportsSeen(reports: IncidentReport[]): string {
  const now = new Date().toISOString();
  const maxCreatedMs = reports.reduce((max, report) => {
    const t = Date.parse(report.createdAt);
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  const seenAt = maxCreatedMs > 0 ? new Date(maxCreatedMs).toISOString() : now;
  writeLastSeenAt(seenAt);
  return seenAt;
}
