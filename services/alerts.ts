"use client";

import { recordFailure, recordSuccess } from "@/services/data-freshness";

export type AlertSeverity = "info" | "watch" | "warning" | "emergency";

export type Alert = {
  id: string;
  source: "GDACS" | "PAGASA" | "NDRRMC";
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
  const [gdacs, pagasa] = await Promise.all([
    readAlertSource("/api/gdacs", "GDACS"),
    readAlertSource("/api/pagasa", "PAGASA"),
  ]);

  const alerts = [...gdacs.alerts, ...pagasa.alerts].sort(
    (a, b) => issuedAtValue(b.issuedAt) - issuedAtValue(a.issuedAt),
  );
  const warnings = [...gdacs.warnings, ...pagasa.warnings];

  if (alerts.length > 0) {
    recordSuccess("alerts");
  } else if (warnings.length > 0) {
    recordFailure("alerts", warnings.join(" | "));
  } else {
    recordSuccess("alerts");
  }

  return { alerts, warnings };
}

async function readAlertSource(
  url: string,
  label: string,
): Promise<AlertsFetchResult> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as {
      alerts?: Alert[];
      error?: string;
      _error?: string;
    };

    const warnings = [
      !res.ok ? formatSourceWarning(label, body.error ?? `HTTP ${res.status}`) : null,
      res.ok && body._error ? formatSourceWarning(label, body._error) : null,
    ].filter((value): value is string => Boolean(value));

    return {
      alerts: Array.isArray(body.alerts) ? body.alerts : [],
      warnings,
    };
  } catch (error) {
    return {
      alerts: [],
      warnings: [formatSourceWarning(label, (error as Error).message)],
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
