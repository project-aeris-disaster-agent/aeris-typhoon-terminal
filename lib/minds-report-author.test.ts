/** @jest-environment node */

jest.mock("@/lib/minds-client", () => ({
  mindsClientAvailable: jest.fn(),
  sendWatchMessageConfirmed: jest.fn(),
  describeMindsApiError: jest.fn(() => "boom"),
}));

import {
  mindsClientAvailable,
  sendWatchMessageConfirmed,
} from "@/lib/minds-client";
import {
  composeMindReportNarrative,
  formatNarrativePrompt,
} from "@/lib/minds-report-author";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";

const mockedAvailable = mindsClientAvailable as jest.MockedFunction<
  typeof mindsClientAvailable
>;
const mockedSendConfirmed = sendWatchMessageConfirmed as jest.MockedFunction<
  typeof sendWatchMessageConfirmed
>;

function fakeSnapshot(): NationalWeatherSnapshot {
  return {
    generatedAt: "2026-05-27T14:00:00.000Z",
    scope: { type: "national", key: "PH" },
    alerts: [],
    alertSignature: "sig",
    typhoonAlerts: [],
    nationalForecast: {
      maxWindKph: 20,
      totalRainMm: 5,
      minPressureHpa: 1010,
      daily: [],
    },
    nationalForecastAlert: { level: 1, score: 10, label: "Monitor", tone: "ok" },
    regionalForecasts: [],
    worstRegionalAlert: { level: 1, score: 10, label: "Monitor", tone: "ok" },
    waterLevels: { updatedAt: null, elevated: [], stationCount: 0 },
    verdict: { tone: "ok", label: "Monitor", reasons: [] },
    severityScore: 12,
    sourcesFreshness: {
      gdacs: null,
      openMeteo: "2026-05-27T14:00:00.000Z",
      waterLevels: null,
    },
    briefFacts: [],
  };
}

const composed = {
  headline: "Daily brief",
  body: "Calm week.",
  structured: {
    hazards: [],
    actions: [],
    severityScore: 12,
    verdictLabel: "Monitor",
    validScope: "PH",
  },
};

describe("minds-report-author", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.MINDS_NOTIFY_ENABLED = "true";
    process.env.MINDS_REPORT_NARRATIVE_ENABLED = "true";
    mockedAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = env;
    jest.clearAllMocks();
  });

  it("prompt forbids emailing and inventing figures", () => {
    const prompt = formatNarrativePrompt({
      reportType: "daily",
      composed,
      snapshot: fakeSnapshot(),
    });
    expect(prompt).toContain("AERIS NARRATIVE TASK");
    expect(prompt).toContain("Do not send any email");
    expect(prompt).toContain("Do not invent figures");
    expect(prompt).toContain("Daily brief");
  });

  it("returns the trimmed reply when the Mind responds", async () => {
    mockedSendConfirmed.mockResolvedValue({
      confirmed: true,
      replyText: "  Stage assets in low-lying areas.  ",
    });
    const narrative = await composeMindReportNarrative({
      reportType: "daily",
      composed,
      snapshot: fakeSnapshot(),
    });
    expect(narrative).toBe("Stage assets in low-lying areas.");
  });

  it("returns null on timeout", async () => {
    mockedSendConfirmed.mockResolvedValue({ confirmed: false });
    const narrative = await composeMindReportNarrative({
      reportType: "daily",
      composed,
      snapshot: fakeSnapshot(),
    });
    expect(narrative).toBeNull();
  });

  it("returns null when the narrative flag is off, without sending", async () => {
    process.env.MINDS_REPORT_NARRATIVE_ENABLED = "false";
    const narrative = await composeMindReportNarrative({
      reportType: "daily",
      composed,
      snapshot: fakeSnapshot(),
    });
    expect(narrative).toBeNull();
    expect(mockedSendConfirmed).not.toHaveBeenCalled();
  });

  it("skips when the caller has no reply budget", async () => {
    const narrative = await composeMindReportNarrative({
      reportType: "daily",
      composed,
      snapshot: fakeSnapshot(),
      timeoutMs: 200,
    });
    expect(narrative).toBeNull();
    expect(mockedSendConfirmed).not.toHaveBeenCalled();
  });
});
