"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Siren, X } from "lucide-react";
import type { IncidentReport } from "@/services/reports-client";
import { pickToastReports } from "@/lib/report-toasts";

const REPORTS_UPDATED_EVENT = "aeris:reports-updated";
/** Toasts on screen at once; the rest collapse into a "+N more" chip. */
const MAX_VISIBLE = 3;
/** Auto-dismiss, long enough to read and act on. */
const TOAST_TTL_MS = 15_000;

type Toast = { report: IncidentReport; expiresAt: number };

/**
 * FLOOD CONTROL-style alert toasts for NEW urgent ground reports (the game's
 * "CALL FOR HELP" stack): white card, red stripe, spaced-caps title, a Go to
 * action. Listens to ReportPingsSync's poll (`aeris:reports-updated`), so it
 * adds no network traffic of its own.
 */
export function ReportToasts({
  onGoTo,
  onOpenReports,
  hidden,
}: {
  /** Fly the map to the report. */
  onGoTo: (report: IncidentReport) => void;
  /** Open the Live Reports list. */
  onOpenReports: () => void;
  /** Hide while the Live Reports popover is open (it already lists them). */
  hidden?: boolean;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const reports = (event as CustomEvent<{ reports?: IncidentReport[] }>).detail?.reports;
      if (!Array.isArray(reports)) return;
      const { seen, fresh } = pickToastReports(seenRef.current, reports);
      seenRef.current = seen;
      if (fresh.length === 0) return;
      const expiresAt = Date.now() + TOAST_TTL_MS;
      setToasts((prev) => [...fresh.map((report) => ({ report, expiresAt })), ...prev]);
    };
    window.addEventListener(REPORTS_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(REPORTS_UPDATED_EVENT, onUpdate);
  }, []);

  // One timer for the whole stack: drop expired toasts.
  useEffect(() => {
    if (toasts.length === 0) return;
    const next = Math.min(...toasts.map((t) => t.expiresAt));
    const id = window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.expiresAt > Date.now())),
      Math.max(0, next - Date.now()) + 50,
    );
    return () => window.clearTimeout(id);
  }, [toasts]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.report.id !== id));
  }, []);

  if (hidden || toasts.length === 0) return null;

  const visible = toasts.slice(0, MAX_VISIBLE);
  const overflow = toasts.length - visible.length;

  return (
    <div
      // Below lg the search/ad chrome is in-flow above the map, so the stack
      // only has to clear the zoom buttons. From lg the chrome floats at the
      // top of the map, so the stack drops below it (and below the zoom pill).
      className="pointer-events-none absolute right-14 top-3 z-[41] flex w-[min(20rem,calc(100%-4.5rem))] flex-col items-end gap-2 lg:right-3 lg:top-[8.75rem]"
      role="region"
      aria-label="Urgent report alerts"
      aria-live="polite"
    >
      {visible.map(({ report }) => (
        <article
          key={report.id}
          className="aeris-incident aeris-rise pointer-events-auto w-full px-3 py-2.5 shadow-pop"
          data-tone="danger"
        >
          <header className="flex items-center gap-1.5 text-aeris-danger">
            <Siren size={14} aria-hidden className="shrink-0" />
            <span className="text-[0.6875rem] font-black uppercase tracking-[0.12em]">
              Urgent report · {report.category}
            </span>
            <button
              type="button"
              onClick={() => {
                onGoTo(report);
                dismiss(report.id);
              }}
              className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-black text-aeris-ink2 hover:bg-aeris-elev hover:text-aeris-accent"
            >
              Go to
            </button>
            <button
              type="button"
              onClick={() => dismiss(report.id)}
              aria-label="Dismiss alert"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-aeris-muted hover:bg-aeris-elev hover:text-aeris-text"
            >
              <X size={12} aria-hidden />
            </button>
          </header>
          <p className="mt-1 line-clamp-2 text-body-sm font-bold leading-snug text-aeris-text">
            {report.description}
          </p>
        </article>
      ))}
      {overflow > 0 && (
        <button
          type="button"
          onClick={onOpenReports}
          className="aeris-round pointer-events-auto !h-7 !px-3 text-[0.75rem] !text-aeris-accent"
        >
          +{overflow} more · open reports
        </button>
      )}
    </div>
  );
}
