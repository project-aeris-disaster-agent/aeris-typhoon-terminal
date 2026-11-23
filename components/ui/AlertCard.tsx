"use client";

import { clsx } from "clsx";
import {
  ExternalLink,
  Info,
  Megaphone,
  ShieldAlert,
  Siren,
  type LucideIcon,
} from "lucide-react";
import {
  alertSeverityTone,
  type Alert,
  type AlertSeverity,
} from "@/services/alerts";

type SafetyTone = "ok" | "default" | "warn" | "danger";

// Game incident card: white card, tone carried by the left stripe + header ink.
const TONE_INK: Record<SafetyTone, string> = {
  ok: "text-aeris-ok",
  default: "text-aeris-accent",
  warn: "text-aeris-warn",
  danger: "text-aeris-danger",
};

const TONE_STRIPE: Record<SafetyTone, string | undefined> = {
  ok: "ok",
  default: "accent",
  warn: undefined, // the stripe's default is the game's warm orange
  danger: "danger",
};

const ALERT_SEVERITY_ICON: Record<AlertSeverity, LucideIcon> = {
  emergency: Siren,
  warning: ShieldAlert,
  watch: Megaphone,
  info: Info,
};

const TIMESTAMP_FMT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-PH", TIMESTAMP_FMT);
}

function issuedLabel(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return `Issued ${formatTimestamp(iso)}`;
  const ageMs = Date.now() - ms;
  if (ageMs < 60 * 60 * 1000) return `Issued ${formatTimestamp(iso)}`;
  if (ageMs < 86_400_000) {
    const hours = Math.floor(ageMs / 3_600_000);
    return `Issued ${hours}h ago`;
  }
  const days = Math.floor(ageMs / 86_400_000);
  return `Issued ${days}d ago`;
}

function alertTone(severity: AlertSeverity): SafetyTone {
  const tone = alertSeverityTone(severity);
  return tone === "accent" ? "default" : tone;
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function AlertCard({
  alert,
  context,
}: {
  alert: Alert;
  /** Optional relevance line (e.g. distance to selected map point). */
  context?: string;
}) {
  const tone = alertTone(alert.severity);
  const Icon = ALERT_SEVERITY_ICON[alert.severity];
  const showSummary =
    alert.summary.length > 0 &&
    normalizeText(alert.summary) !== normalizeText(alert.title);

  return (
    <article
      className="aeris-incident px-3 py-2.5 transition-colors"
      data-tone={TONE_STRIPE[tone]}
    >
      <header className={clsx("flex items-center gap-1.5 mb-1", TONE_INK[tone])}>
        <Icon size={13} className="shrink-0" aria-hidden />
        <span className="text-[0.6875rem] font-black uppercase tracking-[0.12em]">
          {alert.severity}
        </span>
        <span className="chrome-label opacity-70">{alert.source}</span>
        {alert.issuedAt ? (
          <time
            dateTime={alert.issuedAt}
            title={formatTimestamp(alert.issuedAt)}
            className="ml-auto chrome-label opacity-70"
          >
            {issuedLabel(alert.issuedAt)}
          </time>
        ) : alert.url ? (
          <a
            href={alert.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-0.5 chrome-label opacity-70 hover:opacity-100"
            aria-label="Open official source"
          >
            <ExternalLink size={12} aria-hidden />
          </a>
        ) : null}
      </header>

      <p className="text-body-sm font-black text-aeris-text mb-0.5">
        {alert.title}
      </p>

      {context ? (
        <p className="text-[0.6875rem] font-bold text-aeris-muted leading-snug mb-0.5">
          {context}
        </p>
      ) : null}

      {/* Summary only when it adds something; the old fallback printed the
          title a second time. */}
      {showSummary ? (
        <p className="text-body-sm text-aeris-ink2 line-clamp-4">
          {alert.summary}
        </p>
      ) : null}
    </article>
  );
}
