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
