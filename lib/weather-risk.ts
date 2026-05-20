import type { GdacsAlert } from "@/lib/gdacs-alerts";
import {
  computeForecastAlert,
  type ForecastAlert,
  type ForecastSummary,
} from "@/lib/forecast-alert";

export type AlertSeverity = "info" | "watch" | "warning" | "emergency";

export type SafetyTone = "ok" | "default" | "warn" | "danger";

export type WaterLevelBand = "normal" | "alert" | "alarm" | "critical" | "nodata";

export type NationalVerdict = {
  tone: SafetyTone;
  label: string;
  reasons: string[];
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  watch: 1,
  warning: 2,
  emergency: 3,
};

const TONE_RANK: Record<SafetyTone, number> = {
  ok: 0,
  default: 1,
  warn: 2,
  danger: 3,
};

export function alertSeverityToTone(severity: AlertSeverity): SafetyTone {
  switch (severity) {
    case "emergency":
      return "danger";
    case "warning":
      return "warn";
    case "watch":
      return "default";
    case "info":
    default:
      return "ok";
  }
}

export function forecastToneToSafety(tone: ForecastAlert["tone"]): SafetyTone {
  return tone;
}

export function waterBandToTone(level: WaterLevelBand): SafetyTone | null {
  switch (level) {
    case "critical":
      return "danger";
    case "alarm":
      return "warn";
    case "alert":
      return "default";
    default:
      return null;
  }
}

export function pickHighestTone(tones: SafetyTone[]): SafetyTone {
  return tones.reduce(
    (best, tone) => (TONE_RANK[tone] > TONE_RANK[best] ? tone : best),
    "ok",
  );
}

export function worstAlertSeverity(alerts: GdacsAlert[]): AlertSeverity | null {
  let worst: AlertSeverity | null = null;
  for (const alert of alerts) {
    if (!worst || SEVERITY_RANK[alert.severity] > SEVERITY_RANK[worst]) {
      worst = alert.severity;
    }
  }
  return worst;
}

export function computeNationalVerdict(args: {
  forecastAlert: ForecastAlert | null;
  worstAlertSeverity: AlertSeverity | null;
  elevatedWaterCount: number;
  typhoonCount: number;
}): NationalVerdict {
  const tones: SafetyTone[] = [];
  const reasons: string[] = [];

  if (args.forecastAlert && args.forecastAlert.level >= 2) {
    tones.push(forecastToneToSafety(args.forecastAlert.tone));
    reasons.push(
      `${args.forecastAlert.label.toLowerCase()} national weather risk (7-day outlook)`,
    );
  }

  if (args.worstAlertSeverity) {
    tones.push(alertSeverityToTone(args.worstAlertSeverity));
    reasons.push(`${args.worstAlertSeverity} hazard bulletin active`);
  }

  if (args.typhoonCount > 0) {
    tones.push(args.typhoonCount > 0 ? "warn" : "ok");
    reasons.push(
      `${args.typhoonCount} tropical cyclone${args.typhoonCount === 1 ? "" : "s"} in PAR`,
    );
  }

  if (args.elevatedWaterCount > 0) {
    tones.push(args.elevatedWaterCount >= 2 ? "danger" : "warn");
    reasons.push(
      `${args.elevatedWaterCount} NCR river gauge${args.elevatedWaterCount === 1 ? "" : "s"} at alert or above`,
    );
  }

  const tone = tones.length > 0 ? pickHighestTone(tones) : "ok";

  const label =
    tone === "danger"
      ? "High risk"
      : tone === "warn"
        ? "Caution"
        : tone === "default"
          ? "Monitor"
          : "All clear";

  return { tone, label, reasons };
}

export function computeNationalSeverityScore(args: {
  forecastAlert: ForecastAlert | null;
  alerts: GdacsAlert[];
  elevatedWaterCount: number;
  typhoonCount: number;
}): number {
  let score = args.forecastAlert?.score ?? 0;

  const worst = worstAlertSeverity(args.alerts);
  if (worst === "emergency") score += 40;
  else if (worst === "warning") score += 28;
  else if (worst === "watch") score += 14;

  score += args.typhoonCount * 12;
  score += args.elevatedWaterCount * 10;

  for (const alert of args.alerts) {
    if (alert.id.startsWith("tc-") && alert.severity === "emergency") score += 20;
  }

  return Math.min(100, score);
}

export function alertSignature(alerts: GdacsAlert[]): string {
  return alerts
    .map((a) => a.id)
    .sort()
    .join("|");
}

export function formatPhTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(new Date(iso));
}

export function phDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function hoursSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 3_600_000;
}

export function summarizeForecastForBrief(
  summary: ForecastSummary,
  alert: ForecastAlert,
): string {
  const peakRain = Math.max(...summary.daily.map((d) => d.rainMm), 0);
  const parts = [
    `7-day outlook: ${alert.label} risk`,
    `peak daily rain ${peakRain.toFixed(1)} mm`,
    `max wind ${summary.maxWindKph} km/h`,
    `lowest pressure ${summary.minPressureHpa} hPa`,
    `cumulative rain ${summary.totalRainMm.toFixed(1)} mm`,
  ];
  return parts.join("; ");
}
