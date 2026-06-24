import {
  describeMindsApiError,
  mindsClientAvailable,
  sendWatchMessage,
} from "@/lib/minds-client";
import {
  getDashboardPublicUrl,
  getMindsWatchAlias,
  isMindsNotifyEnabled,
} from "@/lib/minds-config";
import { formatPhTimestamp } from "@/lib/weather-risk";
import type { ComposedWeatherReport } from "@/services/weather-report-compose";
import { formatAgentWeatherMessage } from "@/services/weather-report-compose";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";
import type { WeatherReportType } from "@/services/weather-report-triggers";
import type { TriageResult } from "@/services/ai-triage";

export type TriageDigestItem = {
  reportId: string;
  category: string;
  description: string;
  priority: TriageResult["priority"];
  rationale?: string;
  confidence?: number;
};

export type WeatherDigestInput = {
  reportType: WeatherReportType;
  triggerReason: string;
  composed: ComposedWeatherReport;
  snapshot: NationalWeatherSnapshot;
  reportId: string;
};

export type VerdictChangeDigestInput = {
  snapshot: NationalWeatherSnapshot;
  previousSeverityScore: number;
  previousVerdictLabel: string | null;
  triggerReason: string;
  changeReason: string;
};

const DISCLAIMER =
  "Not an official PAGASA product. Follow PAGASA, NDRRMC, and your LGU for evacuation orders.";

export function formatWeatherDigest(input: WeatherDigestInput): string {
  const { reportType, triggerReason, composed, snapshot, reportId } = input;
  const badge = reportType === "daily" ? "DAILY BRIEF" : "BREAKING";
  const stamp = formatPhTimestamp(snapshot.generatedAt);
  const agentBlock = formatAgentWeatherMessage(
    reportType,
    composed.headline,
    composed.body,
    snapshot.generatedAt,
  );

  const drivers =
    snapshot.verdict.reasons.length > 0
      ? snapshot.verdict.reasons.join("; ")
      : "none listed";

  const lines = [
    `AERIS WATCH OFFICER · ${badge} · ${stamp} PHT`,
    "",
    agentBlock,
    "",
    "METADATA",
    `- AERIS risk (composite, not PAGASA TCWS): ${snapshot.verdict.label} [AERIS composite verdict]`,
    `- Drivers: ${drivers}`,
    `- Severity score: ${snapshot.severityScore}`,
    `- Trigger: ${triggerReason}`,
    `- Report ID: ${reportId}`,
    `- Dashboard: ${getDashboardPublicUrl()}`,
    "",
    DISCLAIMER,
  ];

  return lines.join("\n");
}

export function formatTriageDigest(items: TriageDigestItem[]): string {
  if (items.length === 0) return "";

  const stamp = formatPhTimestamp(new Date().toISOString());
  const lines = [
    `AERIS WATCH OFFICER · URGENT TRIAGE · ${stamp} PHT`,
    "",
    `${items.length} urgent incident(s) triaged in the latest cron batch:`,
    "",
  ];

  for (const item of items.slice(0, 5)) {
    const confidencePct =
      typeof item.confidence === "number"
        ? `${Math.round(item.confidence * 100)}%`
        : "n/a";
    const description =
      item.description.length > 200
        ? `${item.description.slice(0, 197).trim()}...`
        : item.description;
    lines.push(
      `- [${item.category}] report ${item.reportId}`,
      `  Priority: ${item.priority} · Confidence: ${confidencePct}`,
      item.rationale ? `  Rationale: ${item.rationale}` : "",
      `  Report: ${description}`,
      "",
    );
  }

  if (items.length > 5) {
    lines.push(`… and ${items.length - 5} more urgent item(s).`, "");
  }

  lines.push(`Dashboard: ${getDashboardPublicUrl()}`, "", DISCLAIMER);
  return lines.filter((line) => line !== "").join("\n");
}

export function formatVerdictChangeDigest(input: VerdictChangeDigestInput): string {
  const stamp = formatPhTimestamp(input.snapshot.generatedAt);
  const scoreDelta = input.snapshot.severityScore - input.previousSeverityScore;
  const drivers =
    input.snapshot.verdict.reasons.length > 0
      ? input.snapshot.verdict.reasons.join("; ")
      : "none listed";

  const lines = [
    `AERIS WATCH OFFICER · VERDICT SHIFT · ${stamp} PHT`,
    "",
    "Conditions changed since the last national brief — no new full report was generated.",
    "",
    "AERIS RISK (composite, not PAGASA TCWS)",
    `- Now: ${input.snapshot.verdict.label} [AERIS composite verdict]`,
    input.previousVerdictLabel
      ? `- Was: ${input.previousVerdictLabel}`
      : "- Previous verdict: unknown",
    `- Severity: ${input.previousSeverityScore} → ${input.snapshot.severityScore} (${scoreDelta >= 0 ? "+" : ""}${scoreDelta})`,
    `- Drivers: ${drivers}`,
    `- Change: ${input.changeReason}`,
    `- Cron gate: ${input.triggerReason}`,
    "",
    `Dashboard: ${getDashboardPublicUrl()}`,
    "",
    DISCLAIMER,
  ];

  return lines.join("\n");
}

export function shouldNotifyTriageBatch(items: TriageDigestItem[]): boolean {
  return items.some(
    (item) =>
      item.priority === "urgent" ||
      item.category.trim().toUpperCase() === "SOS",
  );
}

export type NotifyWatchOfficerPayload =
  | { kind: "weather_report"; digest: WeatherDigestInput }
  | { kind: "verdict_change"; digest: VerdictChangeDigestInput }
  | { kind: "triage_batch"; items: TriageDigestItem[] };

export async function notifyWatchOfficer(
  payload: NotifyWatchOfficerPayload,
): Promise<boolean> {
  if (!isMindsNotifyEnabled()) return false;
  if (!mindsClientAvailable()) {
    console.warn(
      "[minds-watch] MINDS_NOTIFY_ENABLED is true but MINDS_BUILDER_API_KEY or MINDS_AERIS_MIND_ID is missing.",
    );
    return false;
  }

  let messageText = "";
  if (payload.kind === "weather_report") {
    messageText = formatWeatherDigest(payload.digest);
  } else if (payload.kind === "verdict_change") {
    messageText = formatVerdictChangeDigest(payload.digest);
  } else {
    if (!shouldNotifyTriageBatch(payload.items)) return false;
    messageText = formatTriageDigest(payload.items);
  }

  if (!messageText.trim()) return false;

  try {
    await sendWatchMessage({
      alias: getMindsWatchAlias(),
      messageText,
    });
    return true;
  } catch (error) {
    console.error(
      `[minds-watch] notify failed (${payload.kind}): ${describeMindsApiError(error)}`,
    );
    return false;
  }
}
