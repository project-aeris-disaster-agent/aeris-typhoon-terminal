"use client";

import { recordFailure, recordSuccess } from "@/services/data-freshness";

export type AlertSeverity = "info" | "watch" | "warning" | "emergency";

export type Alert = {
  id: string;
  source: "GDACS" | "PAGASA" | "NDRRMC" | "NEWS";
  severity: AlertSeverity;
  title: string;
  summary: string;
  issuedAt: string | null;
  url?: string;
  region?: string;
};

export type AlertsFetchResult = {
  alerts: Alert[];
  warnings: string[];
  /** True when GDACS could not be reached, not when PAR is simply quiet. */
  fetchFailed: boolean;
};

export function alertSeverityTone(s: AlertSeverity) {
  switch (s) {
    case "emergency":
      return "danger" as const;
    case "warning":
      return "warn" as const;
    case "watch":
      return "accent" as const;
    case "info":
    default:
      return "default" as const;
  }
}

export async function fetchAlerts(): Promise<AlertsFetchResult> {
  try {
    const res = await fetch("/api/alerts", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as {
      alerts?: Alert[];
      error?: string | null;
    };

    const alerts = (Array.isArray(body.alerts) ? body.alerts : []).sort(
      (a, b) => issuedAtValue(b.issuedAt) - issuedAtValue(a.issuedAt),
    );

    const upstreamError =
      (typeof body.error === "string" && body.error.trim()) ||
      (!res.ok ? `HTTP ${res.status}` : "");
    const fetchFailed = alerts.length === 0 && Boolean(upstreamError);
    const warnings =
      fetchFailed && upstreamError
        ? [formatSourceWarning("GDACS", upstreamError)]
        : [];

    if (alerts.length > 0) recordSuccess("alerts");
    else if (fetchFailed) recordFailure("alerts", upstreamError);
    else recordSuccess("alerts");

    return { alerts, warnings, fetchFailed };
  } catch (error) {
    const message = (error as Error).message;
    recordFailure("alerts", message);
    return {
      alerts: [],
      warnings: [formatSourceWarning("GDACS", message)],
      fetchFailed: true,
    };
  }
}

function formatSourceWarning(source: string, message: string) {
  return `${source}: ${message}`;
}

function issuedAtValue(value: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
