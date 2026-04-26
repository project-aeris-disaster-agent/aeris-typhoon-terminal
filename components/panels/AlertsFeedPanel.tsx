"use client";

import { useEffect, useState } from "react";
import { CardHeader, Pill } from "../ui/Card";
import { VirtualList } from "../ui/VirtualList";
import { FreshnessTag } from "../ui/FreshnessTag";
import {
  fetchAlerts,
  type AlertsFetchResult,
  type Alert,
  alertSeverityTone,
} from "@/services/alerts";

export function AlertsFeedPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const result: AlertsFetchResult = await fetchAlerts();
        if (!cancelled) {
          setAlerts(result.alerts);
          setWarnings(result.warnings);
          setError(result.alerts.length === 0 && result.warnings.length > 0 ? result.warnings.join(" | ") : null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    const id = window.setInterval(run, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-2">
      <CardHeader
        title="Alerts"
        trailing={
          loading ? (
            <Pill>loading</Pill>
          ) : (
            <Pill tone="accent">{alerts.length}</Pill>
          )
        }
      />

      {error && (
        <div className="text-xs text-aeris-danger">Error: {error}</div>
      )}
      {!error && warnings.length > 0 && (
        <div className="text-xs text-aeris-warn">
          Degraded sources: {warnings.join(" | ")}
        </div>
      )}
      <FreshnessTag source="alerts" />

      <VirtualList
        items={alerts}
        rowHeight={88}
        className="max-h-[280px]"
        emptyText={loading ? "Fetching alerts…" : "No alerts"}
        render={renderAlertRow}
      />
    </div>
  );
}

function renderAlertRow(a: Alert) {
  return (
    <div className="p-2 border-b border-aeris-border/40 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Pill tone={alertSeverityTone(a.severity)}>{a.severity}</Pill>
            <span className="text-aeris-muted text-[10px] font-mono">
              {a.source}
            </span>
          </div>
          <div className="font-medium text-aeris-text truncate">{a.title}</div>
          <div className="text-aeris-muted line-clamp-2 mt-0.5">
            {a.summary}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-aeris-muted/80 font-mono mt-1">
        {a.issuedAt
          ? new Date(a.issuedAt).toLocaleString()
          : "Issued time unavailable"}
      </div>
    </div>
  );
}
