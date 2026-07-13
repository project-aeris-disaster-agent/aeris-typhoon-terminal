/**
 * AERIS Reports auto-email (server-only).
 *
 * Delivers generated national weather briefs to users who opted in via the
 * "AERIS Reports" toggle (aeris_reports_enabled). Mirrors the storm email
 * cycle: recipients windowed by last_active_at, one Minds email task per
 * report, deduped per user per report in aeris_report_email_log.
 */

import {
  describeMindsApiError,
  mindsClientAvailable,
  sendWatchMessage,
} from "@/lib/minds-client";
import { getDashboardPublicUrl, isMindsNotifyEnabled } from "@/lib/minds-config";
import { parseActiveDays } from "@/lib/storm-watch/recipients";
import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";
import { formatPhTimestamp } from "@/lib/weather-risk";
import type { ComposedWeatherReport } from "@/services/weather-report-compose";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";
import type { WeatherReportType } from "@/services/weather-report-triggers";

const DISCLAIMER =
  "Not an official PAGASA product. Follow PAGASA, NDRRMC, and your LGU for evacuation orders.";

export type AerisReportRecipient = {
  userId: string;
  email: string;
  username: string;
};

export async function listAerisReportRecipients(): Promise<AerisReportRecipient[]> {
  const cfg = supabaseRestConfig();
  if (!cfg) return [];

  const activeDays = parseActiveDays();
  const cutoff = new Date(
    Date.now() - activeDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const url = new URL(`${cfg.url}/rest/v1/aeris_user_profiles`);
  url.searchParams.set("select", "user_id,email,username");
  url.searchParams.set("aeris_reports_enabled", "eq.true");
  url.searchParams.set("email", "not.is.null");
  url.searchParams.set("last_active_at", `gte.${cutoff}`);
  url.searchParams.set("order", "last_active_at.desc");

  const res = await fetch(url.toString(), {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[aeris-reports] recipient query failed: ${res.status}`);
    return [];
  }

  const rows = (await res.json()) as Array<{
    user_id: string;
    email: string | null;
    username: string;
  }>;

  const seen = new Set<string>();
  const recipients: AerisReportRecipient[] = [];
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push({ userId: row.user_id, email, username: row.username });
  }
  return recipients;
}

/** User ids already emailed for this report (dedupe on cron retries). */
export async function listReportEmailedUserIds(
  reportId: string,
): Promise<Set<string>> {
  const cfg = supabaseRestConfig();
  if (!cfg) return new Set();

  const url = new URL(`${cfg.url}/rest/v1/aeris_report_email_log`);
  url.searchParams.set("select", "user_id");
  url.searchParams.set("report_id", `eq.${reportId}`);

  const res = await fetch(url.toString(), {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return new Set();
  const rows = (await res.json()) as { user_id: string }[];
  return new Set(rows.map((row) => row.user_id));
}

export async function logReportEmailSent(input: {
  reportId: string;
  reportType: WeatherReportType;
  userId: string;
  recipientEmail: string;
  mindsFingerprint?: string;
}): Promise<boolean> {
  const cfg = supabaseRestConfig();
  if (!cfg) return false;

  const res = await fetch(`${cfg.url}/rest/v1/aeris_report_email_log`, {
    method: "POST",
    headers: {
      ...serviceAuthHeaders(cfg.serviceKey),
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      report_id: input.reportId,
      report_type: input.reportType,
      user_id: input.userId,
      recipient_email: input.recipientEmail,
      minds_fingerprint: input.mindsFingerprint ?? null,
    }),
  });
  return res.ok || res.status === 409;
}

export function aerisReportEmailSubject(
  reportType: WeatherReportType,
  snapshot: NationalWeatherSnapshot,
): string {
  const stamp = formatPhTimestamp(snapshot.generatedAt);
  if (reportType === "breaking") {
    return `AERIS: BREAKING weather report — ${snapshot.verdict.label} (${stamp} PHT)`;
  }
  return `AERIS: Daily weather brief — ${stamp} PHT`;
}

export function aerisReportEmailBody(input: {
  reportType: WeatherReportType;
  composed: ComposedWeatherReport;
  snapshot: NationalWeatherSnapshot;
  reportId: string;
  /** Optional Mind-authored assessment appended under its own heading. */
  mindNarrative?: string | null;
}): string {
  const { reportType, composed, snapshot, reportId, mindNarrative } = input;
  const stamp = formatPhTimestamp(snapshot.generatedAt);
  const drivers =
    snapshot.verdict.reasons.length > 0
      ? snapshot.verdict.reasons.join("; ")
      : "none listed";

  const lines = [
    reportType === "breaking"
      ? "This is a BREAKING AERIS weather report — conditions shifted significantly."
      : "Your daily AERIS national weather brief.",
    "",
    composed.headline,
    "",
    composed.body,
    "",
    "AERIS RISK (composite, not PAGASA TCWS)",
    `- Verdict: ${snapshot.verdict.label}`,
    `- Severity score: ${snapshot.severityScore}`,
    `- Drivers: ${drivers}`,
    `- Generated: ${stamp} PHT`,
    `- Report ID: ${reportId}`,
  ];

  if (mindNarrative?.trim()) {
    lines.push("", "WATCH OFFICER ASSESSMENT", mindNarrative.trim());
  }

  lines.push(
    "",
    "AERIS DASHBOARD",
    `- Live terminal: ${getDashboardPublicUrl()}`,
    "- You receive this because AERIS Reports is enabled in your profile. Toggle it off there to unsubscribe.",
    "",
    DISCLAIMER,
  );

  return lines.join("\n");
}

export function formatMindsReportEmailTask(input: {
  recipients: string[];
  subject: string;
  body: string;
}): string {
  return [
    "AERIS REPORT EMAIL TASK",
    "Send one email per recipient below. Do not reply in chat — email only.",
    "",
    `Recipients: ${input.recipients.join(", ")}`,
    `Subject: ${input.subject}`,
    "",
    "Body:",
    input.body,
  ].join("\n");
}

export async function dispatchAerisReportEmailViaMinds(input: {
  recipients: AerisReportRecipient[];
  subject: string;
  body: string;
}): Promise<{ sent: boolean; fingerprint?: string }> {
  if (!isMindsNotifyEnabled() || !mindsClientAvailable()) {
    console.warn("[aeris-reports] Minds not configured; skipping email dispatch.");
    return { sent: false };
  }
  if (input.recipients.length === 0) return { sent: false };

  const messageText = formatMindsReportEmailTask({
    recipients: input.recipients.map((r) => r.email),
    subject: input.subject,
    body: input.body,
  });

  try {
    const { fingerprint } = await sendWatchMessage({ messageText });
    return { sent: true, fingerprint };
  } catch (error) {
    console.error(
      `[aeris-reports] Minds dispatch failed: ${describeMindsApiError(error)}`,
    );
    return { sent: false };
  }
}
