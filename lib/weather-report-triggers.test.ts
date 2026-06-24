import {
  evaluateNationalReportTriggers,
  evaluateVerdictChangeAlert,
  extractVerdictLabelFromHeadline,
} from "@/services/weather-report-triggers";
import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";

function baseSnapshot(overrides: Partial<NationalWeatherSnapshot> = {}): NationalWeatherSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    scope: { type: "national", key: "PH" },
    alerts: [],
    alertSignature: "",
    typhoonAlerts: [],
    nationalForecast: {
      maxWindKph: 20,
      totalRainMm: 10,
      minPressureHpa: 1010,
      daily: [],
    },
    nationalForecastAlert: { level: 0, score: 5, label: "Low", tone: "ok" },
    regionalForecasts: [],
    worstRegionalAlert: { level: 0, score: 5, label: "Low", tone: "ok" },
    waterLevels: { updatedAt: null, elevated: [], stationCount: 0 },
    verdict: { tone: "ok", label: "All clear", reasons: [] },
    severityScore: 5,
    sourcesFreshness: { gdacs: null, openMeteo: new Date().toISOString(), waterLevels: null },
    briefFacts: [],
    ...overrides,
  };
}

describe("evaluateNationalReportTriggers", () => {
  it("requests daily when no prior daily exists", () => {
    const decision = evaluateNationalReportTriggers(
      baseSnapshot(),
      null,
      null,
      null,
    );
    expect(decision.shouldGenerate).toBe(true);
    expect(decision.reportType).toBe("daily");
    expect(decision.triggerReason).toBe("daily_floor_initial");
  });

  it("requests breaking on severity jump", () => {
    const daily = {
      id: "d1",
      reportType: "daily" as const,
      severityScore: 10,
      alertSignature: "",
      triggerReason: "daily_floor_initial",
      createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    };
    const snapshot = baseSnapshot({ severityScore: 40 });
    const decision = evaluateNationalReportTriggers(snapshot, daily, null, daily);
    expect(decision.shouldGenerate).toBe(true);
    expect(decision.reportType).toBe("breaking");
    expect(decision.triggerReason).toContain("severity_jump");
  });

  it("debounces breaking within 4 hours unless large jump", () => {
    const breaking = {
      id: "b1",
      reportType: "breaking" as const,
      severityScore: 35,
      alertSignature: "tc-1",
      triggerReason: "new_par_typhoon",
      createdAt: new Date(Date.now() - 1 * 3600_000).toISOString(),
    };
    const daily = {
      id: "d1",
      reportType: "daily" as const,
      severityScore: 30,
      alertSignature: "tc-1",
      triggerReason: "daily_floor",
      createdAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
    };
    const snapshot = baseSnapshot({
      severityScore: 48,
      alertSignature: "tc-1",
      typhoonAlerts: [
        {
          id: "tc-1",
          source: "GDACS",
          severity: "warning",
          title: "Storm A",
          summary: "90 km/h",
          issuedAt: null,
        },
      ],
    });
    const decision = evaluateNationalReportTriggers(
      snapshot,
      daily,
      breaking,
      breaking,
    );
    expect(decision.shouldGenerate).toBe(false);
    expect(decision.triggerReason).toBe("breaking_debounced");
  });
});

describe("evaluateVerdictChangeAlert", () => {
  const baseline = {
    id: "d1",
    reportType: "daily" as const,
    severityScore: 20,
    alertSignature: "sig-a",
    triggerReason: "daily_floor",
    createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  };

  it("extracts verdict label from headline", () => {
    expect(
      extractVerdictLabelFromHeadline("Daily situational brief: Monitor — Philippines"),
    ).toBe("Monitor");
  });

  it("notifies on verdict label change without full report", () => {
    const snapshot = baseSnapshot({
      severityScore: 22,
      verdict: { tone: "warn", label: "Caution", reasons: ["Rain band"] },
    });
    const decision = evaluateVerdictChangeAlert(
      snapshot,
      baseline,
      "Daily situational brief: Monitor — Philippines",
      "no_trigger",
    );
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toContain("verdict_Monitor_to_Caution");
  });

  it("skips when change is below thresholds", () => {
    const snapshot = baseSnapshot({
      severityScore: 21,
      verdict: { tone: "ok", label: "Monitor", reasons: [] },
    });
    const decision = evaluateVerdictChangeAlert(
      snapshot,
      baseline,
      "Daily situational brief: Monitor — Philippines",
      "no_trigger",
    );
    expect(decision.shouldNotify).toBe(false);
  });
});
