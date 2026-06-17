"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const PAGASA_PORTAL =
  "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin";
const GDACS_PORTAL = "https://www.gdacs.org/";

export function AlertsFeedPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await load();
    };
    void run();
    const id = window.setInterval(run, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [load]);

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
          className="ml-auto shrink-0 inline-flex items-center gap-1 rounded border border-aeris-border px-1.5 py-0.5 text-chrome font-mono uppercase tracking-wider text-aeris-muted hover:bg-aeris-elev/50 hover:text-aeris-text disabled:opacity-50"
          aria-label="Refresh alerts"
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          Sync
        </button>
      </div>

      <FreshnessTag source="alerts" label="Synced" />

      {error ? (
        <div className="flex items-start gap-1.5 rounded-md border border-aeris-danger/40 bg-aeris-danger/10 px-2 py-1.5 text-body-sm text-aeris-danger">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && alerts.length === 0 ? (
        <p className="text-body-sm text-aeris-muted py-4 text-center">
          Fetching advisories…
        </p>
      ) : null}

      {!loading && alerts.length === 0 && !error ? <EmptyState /> : null}

      {alerts.length > 0 ? (
        <div className="max-h-[min(50vh,320px)] overflow-y-auto pr-0.5 space-y-3">
          {activeSystems.length > 0 ? (
            <section>
              <h3 className="text-label text-aeris-muted mb-1.5">
                Active systems
              </h3>
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
              <h3 className="text-label text-aeris-muted mb-1.5">
                Active hazards
              </h3>
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
    <span className="inline-flex items-center gap-1 rounded-full border border-aeris-border bg-aeris-elev/30 px-2 py-0.5 text-chrome font-mono uppercase tracking-wider text-aeris-muted">
      {label}
      <span className="text-aeris-text">{loading ? "…" : count}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-aeris-ok/30 bg-aeris-ok/10 px-2.5 py-2 space-y-2">
      <div className="flex items-center gap-1.5 text-body-sm text-aeris-ok">
        <CheckCircle2 size={14} aria-hidden />
        <span className="font-medium">
          No active cyclones or GDACS hazards for the Philippines
        </span>
      </div>
      <p className="text-body-sm text-aeris-muted leading-snug">
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
      className="text-body-sm font-mono uppercase tracking-wider text-aeris-accent hover:underline underline-offset-2"
    >
      {label} →
    </a>
  );
}