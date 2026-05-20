import {
  getLatestNationalReport,
  persistWeatherReportBundle,
  supabaseAgentEnabled,
} from "@/lib/supabase-agent";
import {
  composeWeatherReport,
  formatAgentWeatherMessage,
} from "@/services/weather-report-compose";
import {
  evaluateNationalReportTriggers,
  type StoredWeatherReportMeta,
  type WeatherReportType,
} from "@/services/weather-report-triggers";
import { buildNationalWeatherSnapshot } from "@/services/weather-snapshot";

export type WeatherReportRunResult = {
  generated: boolean;
  reportType: WeatherReportType | null;
  triggerReason: string;
  reportId?: string;
  messageId?: string;
  severityScore?: number;
};

export async function runNationalWeatherReportCycle(options?: {
  forceDaily?: boolean;
  forceBreaking?: boolean;
}): Promise<WeatherReportRunResult> {
  if (!supabaseAgentEnabled()) {
    throw new Error("Supabase is not configured for weather report persistence.");
  }

  const snapshot = await buildNationalWeatherSnapshot();

  const [latestDaily, latestBreaking] = await Promise.all([
    getLatestNationalReport("daily"),
    getLatestNationalReport("breaking"),
  ]);

  const latestAny =
    !latestDaily && !latestBreaking
      ? null
      : [latestDaily, latestBreaking]
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0] ?? null;

  const metaFrom = (r: typeof latestDaily): StoredWeatherReportMeta | null =>
    r
      ? {
          id: r.id,
          reportType: r.reportType,
          severityScore: r.severityScore,
          alertSignature: r.alertSignature,
          triggerReason: r.triggerReason,
          createdAt: r.createdAt,
        }
      : null;

  let decision = evaluateNationalReportTriggers(
    snapshot,
    metaFrom(latestDaily),
    metaFrom(latestBreaking),
    metaFrom(latestAny),
  );

  if (options?.forceDaily) {
    decision = {
      shouldGenerate: true,
      reportType: "daily",
      triggerReason: "manual_force_daily",
    };
  } else if (options?.forceBreaking) {
    decision = {
      shouldGenerate: true,
      reportType: "breaking",
      triggerReason: "manual_force_breaking",
    };
  }

  if (!decision.shouldGenerate || !decision.reportType) {
    return {
      generated: false,
      reportType: null,
      triggerReason: decision.triggerReason,
      severityScore: snapshot.severityScore,
    };
  }

  const composed = await composeWeatherReport(snapshot, decision.reportType);
  const agentMessage = formatAgentWeatherMessage(
    decision.reportType,
    composed.headline,
    composed.body,
    snapshot.generatedAt,
  );

  const { report, message } = await persistWeatherReportBundle({
    snapshot,
    reportType: decision.reportType,
    triggerReason: decision.triggerReason,
    composed,
    agentMessage,
  });

  return {
    generated: true,
    reportType: decision.reportType,
    triggerReason: decision.triggerReason,
    reportId: report.id,
    messageId: message.id,
    severityScore: snapshot.severityScore,
  };
}
