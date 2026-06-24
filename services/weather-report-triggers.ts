import { hoursSince } from "@/lib/weather-risk";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";

export type WeatherReportType = "daily" | "breaking";

export type StoredWeatherReportMeta = {
  id: string;
  reportType: WeatherReportType;
  severityScore: number;
  alertSignature: string;
  triggerReason: string;
  createdAt: string;
};

export type TriggerDecision = {
  shouldGenerate: boolean;
  reportType: WeatherReportType | null;
  triggerReason: string;
};

const BREAKING_DEBOUNCE_HOURS = 4;
const DAILY_INTERVAL_HOURS = 24;
const BREAKING_SCORE_DELTA = 8;
const BREAKING_MIN_SCORE = 28;
/** Lighter Minds ping when conditions shift but no full brief is warranted. */
export const VERDICT_CHANGE_SCORE_DELTA = 5;
export const VERDICT_CHANGE_DEBOUNCE_HOURS = 2;

export type VerdictChangeDecision = {
  shouldNotify: boolean;
  reason: string;
};

export function extractVerdictLabelFromHeadline(headline: string): string | null {
  const match = headline.match(/:\s*(.+?)\s*—\s*Philippines/i);
  return match?.[1]?.trim() ?? null;
}

export function evaluateVerdictChangeAlert(
  snapshot: NationalWeatherSnapshot,
  latestAny: StoredWeatherReportMeta | null,
  latestHeadline: string | null,
  triggerReason: string,
): VerdictChangeDecision {
  if (!latestAny || !latestHeadline) {
    return { shouldNotify: false, reason: "no_baseline" };
  }

  if (
    triggerReason !== "no_trigger" &&
    triggerReason !== "breaking_debounced"
  ) {
    return { shouldNotify: false, reason: "report_or_other_trigger" };
  }

  const hours = hoursSince(latestAny.createdAt);
  const prevScore = latestAny.severityScore;
  const scoreDelta = snapshot.severityScore - prevScore;
  const absDelta = Math.abs(scoreDelta);

  const prevLabel = extractVerdictLabelFromHeadline(latestHeadline);
  const labelChanged =
    Boolean(prevLabel) && prevLabel !== snapshot.verdict.label;

  const signatureChanged = snapshot.alertSignature !== latestAny.alertSignature;

  const reasons: string[] = [];
  if (labelChanged) reasons.push(`verdict_${prevLabel}_to_${snapshot.verdict.label}`);
  if (absDelta >= VERDICT_CHANGE_SCORE_DELTA) {
    reasons.push(`severity_delta_${scoreDelta >= 0 ? "+" : ""}${scoreDelta}`);
  }
  if (signatureChanged && snapshot.severityScore >= BREAKING_MIN_SCORE) {
    reasons.push("alert_signature_shift");
  }

  if (reasons.length === 0) {
    return { shouldNotify: false, reason: "no_material_change" };
  }

  if (
    hours < VERDICT_CHANGE_DEBOUNCE_HOURS &&
    absDelta < BREAKING_SCORE_DELTA
  ) {
    return { shouldNotify: false, reason: "verdict_change_debounced" };
  }

  return { shouldNotify: true, reason: reasons.join(",") };
}

export function evaluateNationalReportTriggers(
  snapshot: NationalWeatherSnapshot,
  latestDaily: StoredWeatherReportMeta | null,
  latestBreaking: StoredWeatherReportMeta | null,
  latestAny: StoredWeatherReportMeta | null,
): TriggerDecision {
  const needsDaily =
    !latestDaily || hoursSince(latestDaily.createdAt) >= DAILY_INTERVAL_HOURS;

  if (needsDaily) {
    return {
      shouldGenerate: true,
      reportType: "daily",
      triggerReason: latestDaily ? "daily_floor_24h" : "daily_floor_initial",
    };
  }

  const breaking = evaluateBreaking(snapshot, latestBreaking, latestAny);
  if (breaking.triggerReason !== "no_trigger") {
    return breaking;
  }

  return { shouldGenerate: false, reportType: null, triggerReason: "no_trigger" };
}

function evaluateBreaking(
  snapshot: NationalWeatherSnapshot,
  latestBreaking: StoredWeatherReportMeta | null,
  latestAny: StoredWeatherReportMeta | null,
): TriggerDecision {
  const reasons: string[] = [];

  const prevScore = latestAny?.severityScore ?? 0;
  const scoreDelta = snapshot.severityScore - prevScore;

  if (
    snapshot.severityScore >= BREAKING_MIN_SCORE &&
    scoreDelta >= BREAKING_SCORE_DELTA
  ) {
    reasons.push(`severity_jump_${scoreDelta}`);
  }

  if (snapshot.typhoonAlerts.length > 0) {
    const prevSig = latestAny?.alertSignature ?? "";
    const newTc = snapshot.typhoonAlerts.some(
      (a) => !prevSig.split("|").includes(a.id),
    );
    if (newTc) reasons.push("new_par_typhoon");
  }

  if (snapshot.waterLevels.elevated.some((s) => s.level === "alarm" || s.level === "critical")) {
    reasons.push("ncr_river_alarm_or_critical");
  }

  if (snapshot.worstRegionalAlert.level >= 3) {
    reasons.push("regional_forecast_high");
  }

  const prevSig = latestAny?.alertSignature ?? "";
  if (
    snapshot.alertSignature !== prevSig &&
    snapshot.alerts.some((a) => a.severity === "emergency" || a.severity === "warning")
  ) {
    reasons.push("new_official_warning");
  }

  if (reasons.length === 0) {
    return { shouldGenerate: false, reportType: null, triggerReason: "no_trigger" };
  }

  if (
    latestBreaking &&
    hoursSince(latestBreaking.createdAt) < BREAKING_DEBOUNCE_HOURS &&
    scoreDelta < 15
  ) {
    return {
      shouldGenerate: false,
      reportType: null,
      triggerReason: "breaking_debounced",
    };
  }

  return {
    shouldGenerate: true,
    reportType: "breaking",
    triggerReason: reasons.join(","),
  };
}
