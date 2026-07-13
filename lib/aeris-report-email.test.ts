/** @jest-environment node */

import {
  aerisReportEmailBody,
  aerisReportEmailSubject,
  formatMindsReportEmailTask,
} from "@/lib/aeris-report-email";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";

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

const composed = {
  headline: "Daily situational brief: Monitor — Philippines",
  body: "Calm week ahead.",
  structured: {
    hazards: [],
    actions: [],
    severityScore: 12,
    verdictLabel: "Monitor",
    validScope: "PH",
  },
};

describe("aeris-report-email", () => {
  it("subject distinguishes daily vs breaking", () => {
    const snapshot = fakeSnapshot();
    expect(aerisReportEmailSubject("daily", snapshot)).toContain("Daily weather brief");
    expect(aerisReportEmailSubject("breaking", snapshot)).toContain("BREAKING");
    expect(aerisReportEmailSubject("breaking", snapshot)).toContain("Monitor");
  });

  it("body includes report content, metadata, opt-out note, and disclaimer", () => {
    const body = aerisReportEmailBody({
      reportType: "daily",
      composed,
      snapshot: fakeSnapshot(),
      reportId: "rep-1",
    });
    expect(body).toContain("Daily situational brief");
    expect(body).toContain("Calm week ahead.");
    expect(body).toContain("Severity score: 12");
    expect(body).toContain("rep-1");
    expect(body).toContain("Toggle it off");
    expect(body).toContain("Not an official PAGASA product");
    expect(body).not.toContain("WATCH OFFICER ASSESSMENT");
  });

  it("body includes Mind narrative section when provided", () => {
    const body = aerisReportEmailBody({
      reportType: "breaking",
      composed,
      snapshot: fakeSnapshot(),
      reportId: "rep-2",
      mindNarrative: "Responders in coastal barangays should stage early.",
    });
    expect(body).toContain("WATCH OFFICER ASSESSMENT");
    expect(body).toContain("stage early");
  });

  it("email task lists all recipients and forbids chat replies", () => {
    const task = formatMindsReportEmailTask({
      recipients: ["a@example.com", "b@example.com"],
      subject: "AERIS: Daily weather brief",
      body: "body text",
    });
    expect(task).toContain("AERIS REPORT EMAIL TASK");
    expect(task).toContain("a@example.com, b@example.com");
    expect(task).toContain("email only");
  });
});
