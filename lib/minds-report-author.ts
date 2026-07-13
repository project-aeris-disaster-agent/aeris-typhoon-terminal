/**
 * Mind-authored report narratives (server-only).
 *
 * Asks the Watch Officer Mind to compose a short operator-facing assessment
 * from the deterministic report data, waiting (bounded) for the reply. The
 * data tables in the email stay deterministic; only this narrative section is
 * Mind-authored. Every failure mode degrades to null so report emails always
 * go out — with or without the assessment.
 */

import {
  describeMindsApiError,
  mindsClientAvailable,
  sendWatchMessageConfirmed,
} from "@/lib/minds-client";
import {
  getMindsWatchAlias,
  isMindsNotifyEnabled,
  isMindsReportNarrativeEnabled,
} from "@/lib/minds-config";
import { formatPhTimestamp } from "@/lib/weather-risk";
import type { ComposedWeatherReport } from "@/services/weather-report-compose";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";
import type { WeatherReportType } from "@/services/weather-report-triggers";

const MAX_NARRATIVE_CHARS = 1_200;

export function formatNarrativePrompt(input: {
  reportType: WeatherReportType;
  composed: ComposedWeatherReport;
  snapshot: NationalWeatherSnapshot;
}): string {
  const { reportType, composed, snapshot } = input;
  const drivers =
    snapshot.verdict.reasons.length > 0
      ? snapshot.verdict.reasons.join("; ")
      : "none listed";

  return [
    "AERIS NARRATIVE TASK",
    "Reply in chat with a short situational assessment (3-5 sentences, plain text, no markdown) for Philippine disaster-response volunteers, first responders, and LGU staff.",
    "Focus on what the data below means operationally: who should prepare, what to watch next, and any caveat about data freshness. Do not invent figures not present below. Do not send any email for this task.",
    "",
    `Report type: ${reportType}`,
    `Generated: ${formatPhTimestamp(snapshot.generatedAt)} PHT`,
    `AERIS verdict (composite, not PAGASA TCWS): ${snapshot.verdict.label}`,
    `Severity score: ${snapshot.severityScore}`,
    `Drivers: ${drivers}`,
    "",
    "Report headline:",
    composed.headline,
    "",
    "Report body:",
    composed.body,
  ].join("\n");
}

/**
 * Best-effort Mind-authored assessment. Returns null when disabled,
 * unconfigured, timed out, or the reply looks unusable.
 */
export async function composeMindReportNarrative(input: {
  reportType: WeatherReportType;
  composed: ComposedWeatherReport;
  snapshot: NationalWeatherSnapshot;
  timeoutMs?: number;
}): Promise<string | null> {
  if (!isMindsReportNarrativeEnabled()) return null;
  if (!isMindsNotifyEnabled() || !mindsClientAvailable()) return null;
  // No budget left to wait for a reply — skip rather than send-and-abandon.
  if (input.timeoutMs !== undefined && input.timeoutMs < 1_000) return null;

  try {
    const delivery = await sendWatchMessageConfirmed({
      alias: getMindsWatchAlias(),
      messageText: formatNarrativePrompt(input),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });

    if (!delivery.confirmed || !delivery.replyText?.trim()) {
      console.warn("[minds-narrative] no reply within timeout; omitting section.");
      return null;
    }

    const narrative = delivery.replyText.trim();
    return narrative.length > MAX_NARRATIVE_CHARS
      ? `${narrative.slice(0, MAX_NARRATIVE_CHARS - 1).trim()}…`
      : narrative;
  } catch (error) {
    console.warn(
      `[minds-narrative] compose failed: ${describeMindsApiError(error)}`,
    );
    return null;
  }
}
