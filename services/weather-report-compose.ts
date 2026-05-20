import { formatPhTimestamp } from "@/lib/weather-risk";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";
import type { WeatherReportType } from "@/services/weather-report-triggers";

export type ComposedWeatherReport = {
  headline: string;
  body: string;
  structured: {
    hazards: string[];
    actions: string[];
    severityScore: number;
    verdictLabel: string;
    validScope: string;
  };
};

const DISCLAIMER =
  "Not an official PAGASA product. Follow PAGASA, NDRRMC, and your LGU for evacuation orders.";

export function composeDeterministicWeatherReport(
  snapshot: NationalWeatherSnapshot,
  reportType: WeatherReportType,
): ComposedWeatherReport {
  const hazards: string[] = [];
  const actions: string[] = [];

  if (snapshot.typhoonAlerts.length > 0) {
    for (const tc of snapshot.typhoonAlerts.slice(0, 2)) {
      hazards.push(tc.title);
    }
    actions.push(
      "Secure loose objects, charge devices, and identify your nearest safe shelter away from coasts and steep slopes.",
    );
  }

  if (snapshot.worstRegionalAlert.level >= 2) {
    hazards.push(
      `Heavy rainfall / strong wind risk in the 7-day outlook (${snapshot.worstRegionalAlert.label} nationally).`,
    );
    actions.push(
      "Clear drainage near your home, avoid unnecessary travel during peak rain, and monitor barangay advisories.",
    );
  }

  for (const station of snapshot.waterLevels.elevated.slice(0, 3)) {
    hazards.push(`River gauge ${station.name} at ${station.level} level.`);
    if (station.level === "alarm" || station.level === "critical") {
      actions.push(
        `If you are in a low-lying area near ${station.name}, prepare to move to higher ground if water continues to rise.`,
      );
    }
  }

  for (const alert of snapshot.alerts.filter((a) => !a.id.startsWith("tc-")).slice(0, 2)) {
    hazards.push(alert.title);
  }

  if (hazards.length === 0) {
    hazards.push("No major tropical cyclone in PAR and no elevated river alarms at this check.");
  }

  if (actions.length === 0) {
    actions.push(
      "Stay informed through official bulletins. Review your go-bag and household communication plan.",
    );
  }

  const typeLabel = reportType === "daily" ? "Daily situational brief" : "Breaking update";
  const headline = `${typeLabel}: ${snapshot.verdict.label} — Philippines`;

  const paragraphs: string[] = [
    `${typeLabel} for the Philippines as of ${formatPhTimestamp(snapshot.generatedAt)} PHT.`,
    snapshot.briefFacts.join(" "),
  ];

  if (snapshot.verdict.reasons.length > 0) {
    paragraphs.push(`Primary drivers: ${snapshot.verdict.reasons.join("; ")}.`);
  }

  paragraphs.push(`Recommended actions: ${actions.slice(0, 4).join(" ")}`);
  paragraphs.push(DISCLAIMER);

  return {
    headline,
    body: paragraphs.join("\n\n"),
    structured: {
      hazards,
      actions,
      severityScore: snapshot.severityScore,
      verdictLabel: snapshot.verdict.label,
      validScope: "PH",
    },
  };
}

export function formatAgentWeatherMessage(
  reportType: WeatherReportType,
  headline: string,
  body: string,
  generatedAt: string,
): string {
  const badge = reportType === "daily" ? "DAILY BRIEF" : "BREAKING";
  const stamp = formatPhTimestamp(generatedAt);
  return `NATIONAL WEATHER ${badge} · ${stamp} PHT\n\n${headline}\n\n${body}`;
}

export async function composeLlmWeatherReport(
  snapshot: NationalWeatherSnapshot,
  reportType: WeatherReportType,
): Promise<ComposedWeatherReport | null> {
  const baseUrl = process.env.AERIS_CHAT_API_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) return null;

  const apiKey = process.env.AERIS_CHAT_API_KEY || process.env.LLM_API_KEY;
  const deterministic = composeDeterministicWeatherReport(snapshot, reportType);

  const systemPrompt = [
    "You are AGENT AERIS producing a Philippines national weather brief for disaster responders and the public.",
    "Use ONLY the JSON snapshot provided. Do not invent signal numbers, landfall times, or evacuation orders.",
    "Write 120–220 words in clear English. Include a short headline line, then body paragraphs.",
    "End with the exact disclaimer sentence provided in the user message.",
    reportType === "breaking"
      ? "This is a BREAKING update — lead with what changed since routine monitoring."
      : "This is a DAILY brief — summarize the overall situation even if conditions are calm.",
  ].join(" ");

  const userContent = JSON.stringify({
    reportType,
    disclaimer: DISCLAIMER,
    snapshot: {
      generatedAt: snapshot.generatedAt,
      verdict: snapshot.verdict,
      severityScore: snapshot.severityScore,
      briefFacts: snapshot.briefFacts,
      typhoonAlerts: snapshot.typhoonAlerts.map((a) => ({
        title: a.title,
        summary: a.summary,
        severity: a.severity,
      })),
      alerts: snapshot.alerts
        .filter((a) => !a.id.startsWith("tc-"))
        .slice(0, 5)
        .map((a) => ({ title: a.title, severity: a.severity, summary: a.summary })),
      waterElevated: snapshot.waterLevels.elevated.map((s) => ({
        name: s.name,
        level: s.level,
        current: s.current,
      })),
      worstRegional: {
        label: snapshot.worstRegionalAlert.label,
        score: snapshot.worstRegionalAlert.score,
      },
    },
    fallbackHeadline: deterministic.headline,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  const response = await fetch(`${baseUrl}/api/llm/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Produce the national weather brief from this snapshot:\n${userContent}`,
        },
      ],
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) return null;

  const data = (await response.json()) as Record<string, unknown>;
  const text =
    (typeof data.message === "string" && data.message) ||
    (typeof data.content === "string" && data.content) ||
    (typeof data.response === "string" && data.response) ||
    "";

  const trimmed = text.trim();
  if (trimmed.length < 80) return null;

  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  const llmHeadline = lines[0] ?? deterministic.headline;
  const llmBody =
    lines.length > 1
      ? lines.slice(1).join("\n\n")
      : trimmed;

  return {
    headline: llmHeadline,
    body: llmBody.includes(DISCLAIMER) ? llmBody : `${llmBody}\n\n${DISCLAIMER}`,
    structured: deterministic.structured,
  };
}

export async function composeWeatherReport(
  snapshot: NationalWeatherSnapshot,
  reportType: WeatherReportType,
): Promise<ComposedWeatherReport> {
  const llm = await composeLlmWeatherReport(snapshot, reportType);
  if (llm) return llm;
  return composeDeterministicWeatherReport(snapshot, reportType);
}
