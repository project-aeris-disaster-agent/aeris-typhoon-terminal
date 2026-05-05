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
  /** For NEWS rows, the outlet name (Rappler, Inquirer, …). */
  region?: string;
};

export type AlertsFetchResult = {
  alerts: Alert[];
  warnings: string[];
};

const ALERTS_STALE_CACHE_MS = 30 * 60 * 1000;
let lastHealthyAlerts: Alert[] = [];
let lastHealthyAt = 0;

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

  const mergedOfficial = dedupeAlerts([...gdacs.alerts, ...pagasa.alerts]);
  const warnings = [...gdacs.warnings, ...pagasa.warnings];
  const hasFreshOfficial = mergedOfficial.length > 0;
  const canUseStaleCache =
    !hasFreshOfficial &&
    warnings.length > 0 &&
    lastHealthyAlerts.length > 0 &&
    Date.now() - lastHealthyAt < ALERTS_STALE_CACHE_MS;
  const alerts = (canUseStaleCache ? lastHealthyAlerts : mergedOfficial).sort(
    (a, b) => issuedAtValue(b.issuedAt) - issuedAtValue(a.issuedAt),
  );

  if (hasFreshOfficial) {
    lastHealthyAlerts = mergedOfficial;
    lastHealthyAt = Date.now();
    recordSuccess("alerts");
  } else if (alerts.length > 0 && canUseStaleCache) {
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

function dedupeAlerts(alerts: Alert[]): Alert[] {
  const seen = new Set<string>();
  const deduped: Alert[] = [];
  for (const alert of alerts) {
    const key = [
      alert.source,
      normalizeDedupeText(alert.title),
      normalizeDedupeText(alert.summary),
      alert.url ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(alert);
  }
  return deduped;
}

function normalizeDedupeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
