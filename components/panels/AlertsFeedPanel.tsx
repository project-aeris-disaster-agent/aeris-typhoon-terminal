"use client";

import { useCallback, useMemo, useState } from "react";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Pill } from "../ui/Card";
import { usePanelHeaderBadge } from "@/components/panel-header-badge";
import { AlertCard } from "../ui/AlertCard";
import { FreshnessTag } from "../ui/FreshnessTag";
import {
  fetchAlerts,
  type AlertsFetchResult,
  type Alert,
} from "@/services/alerts";
import { fetchActiveTyphoons } from "@/services/typhoon-tracks";

const PAGASA_PORTAL =
  "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin";
const GDACS_PORTAL = "https://www.gdacs.org/";

export function AlertsFeedPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Storms the Typhoon Tracker is following (JMA/JTWC/PAGASA), which GDACS
   * may not list yet. Without this the panel said "No active cyclones" in
   * green right under a tracker showing a storm approaching PAR.
   */
  const [trackedStorms, setTrackedStorms] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    void fetchActiveTyphoons()
      .then((r) => {
        const names = [...r.storms, ...r.outsideParGdacs].map((s) => s.name);
        if (r.outsidePar?.name) names.push(r.outsidePar.name);
        setTrackedStorms(
          Array.from(
            new Set(names.filter(Boolean).map((n) => n.trim().toUpperCase())),
          ),
        );
      })
      .catch(() => undefined);
    try {
      const result: AlertsFetchResult = await fetchAlerts();
      setAlerts(result.alerts);
      if (result.fetchFailed) {
        setError(
          result.warnings[0] ??
            "Could not reach GDACS. Try Sync again shortly.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useVisiblePolling(() => void load(), 5 * 60 * 1000);

  const { activeSystems, bulletins, activeCount, hazardCount } = useMemo(() => {
    const active: Alert[] = [];
    const rest: Alert[] = [];
    for (const a of alerts) {
      if (a.id.startsWith("tc-")) active.push(a);
      else rest.push(a);
    }
    return {
      activeSystems: active,
      bulletins: rest,
      activeCount: active.length,
      hazardCount: rest.length,
    };
  }, [alerts]);

  const headerBadge = useMemo(() => {
    if (loading) return <Pill>loading</Pill>;
    return <Pill tone="accent">{alerts.length}</Pill>;
  }, [loading, alerts.length]);

  usePanelHeaderBadge("alerts", headerBadge);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <SourceChip label="Active TC" count={activeCount} loading={loading} />
        <SourceChip label="Hazards" count={hazardCount} loading={loading} />
        {loading ? <Pill>loading</Pill> : <Pill tone="accent">{alerts.length}</Pill>}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto shrink-0 aeris-btn-soft h-6 px-2 text-[0.6875rem] uppercase tracking-[0.1em] disabled:opacity-50"
          aria-label="Sync alerts"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          Sync
        </button>
      </div>

      <FreshnessTag source="alerts" label="Synced" />

      {error ? (
        <div className="aeris-incident flex items-start gap-1.5 px-2.5 py-2 text-body-sm font-bold text-aeris-danger" data-tone="danger">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && alerts.length === 0 ? (
        <p className="text-body-sm text-aeris-muted py-4 text-center">
          Fetching advisories…
        </p>
      ) : null}

      {!loading && alerts.length === 0 && !error ? (
        <EmptyState trackedStorms={trackedStorms} />
      ) : null}

      {alerts.length > 0 ? (
        <div className="max-h-[min(50vh,320px)] overflow-y-auto pr-0.5 space-y-3">
          {activeSystems.length > 0 ? (
            <section>
              <h3 className="aeris-label mb-1.5">Active systems</h3>
              <ul className="space-y-2">
                {activeSystems.map((alert) => (
                  <li key={alert.id}>
                    <AlertCard alert={alert} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {bulletins.length > 0 ? (
            <section>
              <h3 className="aeris-label mb-1.5">Active hazards</h3>
              <ul className="space-y-2">
                {bulletins.map((alert) => (
                  <li key={alert.id}>
                    <AlertCard alert={alert} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SourceChip({
  label,
  count,
  loading,
}: {
  label: string;
  count: number;
  loading: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-aeris-elev px-2.5 py-0.5 text-[0.6875rem] font-black uppercase tracking-[0.1em] text-aeris-ink2">
      {label}
      <span className="tabular-nums text-aeris-text">{loading ? "…" : count}</span>
    </span>
  );
}

function EmptyState({ trackedStorms }: { trackedStorms: string[] }) {
  if (trackedStorms.length > 0) {
    const names = trackedStorms.slice(0, 3).join(", ");
    return (
      <div className="aeris-warm-card px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-1.5 text-body-sm text-aeris-warn">
          <AlertTriangle size={14} aria-hidden />
          <span className="font-black">
            No GDACS alerts yet. {trackedStorms.length} storm
            {trackedStorms.length === 1 ? "" : "s"} being monitored
          </span>
        </div>
        <p className="text-body-sm text-aeris-ink2 leading-snug">
          The Typhoon Tracker is following {names}. GDACS has not issued a
          Philippines alert for {trackedStorms.length === 1 ? "it" : "them"}.
          For official PAGASA signal numbers, use the link below.
        </p>
        <div className="flex flex-wrap gap-2">
          <OfficialLink href={PAGASA_PORTAL} label="PAGASA SWB" />
          <OfficialLink href={GDACS_PORTAL} label="GDACS" />
        </div>
      </div>
    );
  }
  return (
    <div className="aeris-incident px-3 py-2.5 space-y-2" data-tone="ok">
      <div className="flex items-center gap-1.5 text-body-sm text-aeris-ok">
        <CheckCircle2 size={14} aria-hidden />
        <span className="font-black">
          No active cyclones or GDACS hazards for the Philippines
        </span>
      </div>
      <p className="text-body-sm text-aeris-ink2 leading-snug">
        No GDACS-tracked systems in the Philippine Area of Responsibility right
        now. For official PAGASA signal numbers, use the link below.
      </p>
      <div className="flex flex-wrap gap-2">
        <OfficialLink href={PAGASA_PORTAL} label="PAGASA SWB" />
        <OfficialLink href={GDACS_PORTAL} label="GDACS" />
      </div>
    </div>
  );
}

function OfficialLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="aeris-btn-ghost h-7 !rounded-full px-3 text-[0.6875rem] uppercase tracking-[0.1em]"
    >
      {label} →
    </a>
  );
}