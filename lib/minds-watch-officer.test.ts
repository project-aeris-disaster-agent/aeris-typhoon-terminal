/** @jest-environment node */

import {
  formatTriageDigest,
  formatWeatherDigest,
  notifyWatchOfficer,
  notifyWatchOfficerDetailed,
  shouldNotifyTriageBatch,
} from "@/lib/minds-watch-officer";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";

jest.mock("@/lib/minds-client", () => ({
  mindsClientAvailable: jest.fn(),
  sendWatchMessage: jest.fn(),
  sendWatchMessageConfirmed: jest.fn(),
  describeMindsApiError: jest.fn(),
}));

import {
  mindsClientAvailable,
  sendWatchMessage,
  sendWatchMessageConfirmed,
} from "@/lib/minds-client";

const mockedAvailable = mindsClientAvailable as jest.MockedFunction<
  typeof mindsClientAvailable
>;
const mockedSend = sendWatchMessage as jest.MockedFunction<typeof sendWatchMessage>;
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
    verdict: {
      tone: "ok",
      label: "Monitor",
      reasons: ["Calm conditions nationally"],
    },
    severityScore: 12,
    sourcesFreshness: {
      gdacs: null,
      openMeteo: "2026-05-27T14:00:00.000Z",
      waterLevels: null,
    },
    briefFacts: ["No TC in PAR."],
  };
}

describe("minds-watch-officer", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.MINDS_NOTIFY_ENABLED;
    mockedAvailable.mockReturnValue(true);
    mockedSend.mockResolvedValue({ fingerprint: "fp-1" });
    mockedSendConfirmed.mockResolvedValue({
      fingerprint: "fp-1",
      confirmed: true,
      replyText: "Acknowledged.",
    });
  });

  afterEach(() => {
    process.env = env;
    jest.clearAllMocks();
  });

  it("formatWeatherDigest includes headline, verdict, and disclaimer", () => {
    const text = formatWeatherDigest({
      reportType: "daily",
      triggerReason: "daily_floor_24h",
      composed: {
        headline: "Daily situational brief: Monitor — Philippines",
        body: "Calm week ahead.",
        structured: {
          hazards: [],
          actions: [],
          severityScore: 12,
          verdictLabel: "Monitor",
          validScope: "PH",
        },
      },
      snapshot: fakeSnapshot(),
      reportId: "report-abc",
    });

    expect(text).toContain("AERIS WATCH OFFICER");
    expect(text).toContain("DAILY BRIEF");
    expect(text).toContain("report-abc");
    expect(text).toContain("[AERIS composite verdict]");
    expect(text).toContain("Not an official PAGASA product");
  });

  it("shouldNotifyTriageBatch is true for urgent or SOS", () => {
    expect(
      shouldNotifyTriageBatch([
        {
          reportId: "1",
          category: "Flood",
          description: "water rising",
          priority: "low_priority",
        },
      ]),
    ).toBe(false);

    expect(
      shouldNotifyTriageBatch([
        {
          reportId: "2",
          category: "SOS",
          description: "trapped",
          priority: "pending",
        },
      ]),
    ).toBe(true);

    expect(
      shouldNotifyTriageBatch([
        {
          reportId: "3",
          category: "Fire",
          description: "smoke",
          priority: "urgent",
        },
      ]),
    ).toBe(true);
  });

  it("formatTriageDigest lists urgent items", () => {
    const text = formatTriageDigest([
      {
        reportId: "r1",
        category: "SOS",
        description: "Need rescue",
        priority: "urgent",
        rationale: "SOS keyword",
        confidence: 0.92,
      },
    ]);
    expect(text).toContain("URGENT TRIAGE");
    expect(text).toContain("r1");
    expect(text).toContain("92%");
  });

  it("notifyWatchOfficer skips when feature flag is off", async () => {
    process.env.MINDS_NOTIFY_ENABLED = "false";
    const sent = await notifyWatchOfficer({
      kind: "weather_report",
      digest: {
        reportType: "daily",
        triggerReason: "daily_floor_24h",
        composed: {
          headline: "h",
          body: "b",
          structured: {
            hazards: [],
            actions: [],
            severityScore: 1,
            verdictLabel: "Monitor",
            validScope: "PH",
          },
        },
        snapshot: fakeSnapshot(),
        reportId: "x",
      },
    });
    expect(sent).toBe(false);
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("notifyWatchOfficer sends when enabled and configured", async () => {
    process.env.MINDS_NOTIFY_ENABLED = "true";
    const sent = await notifyWatchOfficer({
      kind: "weather_report",
      digest: {
        reportType: "breaking",
        triggerReason: "breaking_score_delta",
        composed: {
          headline: "Breaking update",
          body: "Storm approaching.",
          structured: {
            hazards: ["TC alert"],
            actions: ["Prepare"],
            severityScore: 40,
            verdictLabel: "Caution",
            validScope: "PH",
          },
        },
        snapshot: fakeSnapshot(),
        reportId: "rep-99",
      },
    });
    expect(sent).toBe(true);
    // Breaking briefs are critical → confirmed delivery path.
    expect(mockedSendConfirmed).toHaveBeenCalledTimes(1);
    expect(mockedSend).not.toHaveBeenCalled();
    expect(mockedSendConfirmed.mock.calls[0][0].messageText).toContain(
      "BREAKING",
    );
  });

  it("daily briefs stay fire-and-forget", async () => {
    process.env.MINDS_NOTIFY_ENABLED = "true";
    const result = await notifyWatchOfficerDetailed({
      kind: "weather_report",
      digest: {
        reportType: "daily",
        triggerReason: "daily_floor_24h",
        composed: {
          headline: "h",
          body: "b",
          structured: {
            hazards: [],
            actions: [],
            severityScore: 1,
            verdictLabel: "Monitor",
            validScope: "PH",
          },
        },
        snapshot: fakeSnapshot(),
        reportId: "x",
      },
    });
    expect(result).toEqual({ notified: true, critical: false, confirmed: null });
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSendConfirmed).not.toHaveBeenCalled();
  });

  it("urgent triage uses confirmed delivery and reports the outcome", async () => {
    process.env.MINDS_NOTIFY_ENABLED = "true";
    mockedSendConfirmed.mockResolvedValue({ fingerprint: "fp-2", confirmed: false });
    const result = await notifyWatchOfficerDetailed({
      kind: "triage_batch",
      items: [
        {
          reportId: "r1",
          category: "SOS",
          description: "trapped",
          priority: "urgent",
        },
      ],
    });
    expect(result).toEqual({ notified: true, critical: true, confirmed: false });
    expect(mockedSendConfirmed).toHaveBeenCalledTimes(1);
  });

  it("downgrades to fire-and-forget when reply budget is under 1s", async () => {
    process.env.MINDS_NOTIFY_ENABLED = "true";
    const result = await notifyWatchOfficerDetailed(
      {
        kind: "triage_batch",
        items: [
          {
            reportId: "r1",
            category: "SOS",
            description: "trapped",
            priority: "urgent",
          },
        ],
      },
      { replyTimeoutMs: 200 },
    );
    expect(result).toEqual({ notified: true, critical: false, confirmed: null });
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSendConfirmed).not.toHaveBeenCalled();
  });
});
