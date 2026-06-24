"use client";

import { useEffect, useMemo, useState } from "react";
import {
  countUnreadReports,
  markReportsSeen,
  readLastSeenAt,
} from "@/lib/live-reports-read-state";
import {
  fetchReports,
  type IncidentReport,
} from "@/services/reports-client";

const REPORTS_UPDATED_EVENT = "aeris:reports-updated";

export function useUnreadLiveReports(liveReportsOpen: boolean): number {
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);

  useEffect(() => {
    setLastSeenAt(readLastSeenAt());

    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ reports?: IncidentReport[] }>).detail;
      if (Array.isArray(detail?.reports)) {
        setReports(detail.reports);
      }
    };

    window.addEventListener(REPORTS_UPDATED_EVENT, onUpdate);
    void fetchReports()
      .then(setReports)
      .catch(() => undefined);

    return () => window.removeEventListener(REPORTS_UPDATED_EVENT, onUpdate);
  }, []);

  useEffect(() => {
    if (!liveReportsOpen) return;
    void fetchReports()
      .then((data) => {
        setReports(data);
        setLastSeenAt(markReportsSeen(data));
      })
      .catch(() => undefined);
  }, [liveReportsOpen]);

  return useMemo(
    () => countUnreadReports(reports, lastSeenAt),
    [reports, lastSeenAt],
  );
}
