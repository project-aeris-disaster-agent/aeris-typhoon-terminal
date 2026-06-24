import {
  anticipatesFloodRainfall,
  assessTyphoonThreat,
  computeFloodAutomation,
  isTyphoonRelatedAlert,
  pickReturnPeriod,
} from "./flood-automation";
import type { ForecastSummary } from "@/lib/forecast-alert";
import type { Alert } from "@/services/alerts";
import type { Typhoon } from "@/services/typhoon-tracks";

const quietForecast: ForecastSummary = {
  maxWindKph: 15,
  totalRainMm: 8,
  minPressureHpa: 1012,
  daily: Array.from({ length: 7 }, () => ({
    date: "2026-06-01",
    tempMin: 24,
    tempMax: 31,
    rainMm: 1,
    windKph: 12,
    pressureHpa: 1012,
  })),
};

const rainyForecast: ForecastSummary = {
  ...quietForecast,
  totalRainMm: 45,
  daily: quietForecast.daily.map((d, i) => ({
    ...d,
    rainMm: i === 2 ? 22 : 4,
  })),
};

const typhoonAlert: Alert = {
  id: "tc-1",
  source: "GDACS",
  severity: "warning",
  title: "Typhoon MARING — Tropical Cyclone Advisory",
  summary: "Signal No. 2 in effect",
  issuedAt: null,
};

const storm = (windKph: number): Typhoon => ({
  id: "s1",
  name: "MARING",
  category: "Typhoon",
  position: [125, 14],
  windKph,
  pressureHpa: 980,
  bestTrack: [],
  forecast: [],
});

describe("flood-automation", () => {
  it("detects anticipated rainfall", () => {
    expect(anticipatesFloodRainfall(quietForecast)).toBe(false);
    expect(anticipatesFloodRainfall(rainyForecast)).toBe(true);
    expect(anticipatesFloodRainfall(null)).toBe(false);
  });

  it("flags typhoon-related alerts", () => {
    expect(isTyphoonRelatedAlert(typhoonAlert)).toBe(true);
    expect(
      isTyphoonRelatedAlert({
        ...typhoonAlert,
        title: "Heat index advisory",
        summary: "Hot afternoon",
      }),
    ).toBe(false);
  });

  it("escalates threat tier from cyclone wind and advisories", () => {
    expect(
      assessTyphoonThreat({ alerts: [], typhoons: [storm(50)] }),
    ).toBe(0);
    expect(
      assessTyphoonThreat({ alerts: [typhoonAlert], typhoons: [] }),
    ).toBe(2);
    expect(
      assessTyphoonThreat({ alerts: [], typhoons: [storm(190)] }),
    ).toBe(3);
  });

  it("maps threat tier to the best available return period", () => {
    expect(pickReturnPeriod(0, ["5yr"])).toBe("5yr");
    expect(pickReturnPeriod(3, ["5yr"])).toBe("5yr");
    expect(pickReturnPeriod(3, ["5yr", "25yr", "100yr"])).toBe("100yr");
    expect(pickReturnPeriod(2, ["5yr", "25yr"])).toBe("25yr");
  });

  it("auto-enables flood projections for rain or typhoon risk", () => {
    const off = computeFloodAutomation({
      forecast: quietForecast,
      alerts: [],
      typhoons: [],
      availablePeriods: ["5yr"],
    });
    expect(off.enabled).toBe(false);

    const rain = computeFloodAutomation({
      forecast: rainyForecast,
      alerts: [],
      typhoons: [],
      availablePeriods: ["5yr"],
    });
    expect(rain.enabled).toBe(true);
    expect(rain.returnPeriod).toBe("5yr");
    expect(rain.reason).toContain("Auto on");

    const typhoon = computeFloodAutomation({
      forecast: quietForecast,
      alerts: [typhoonAlert],
      typhoons: [storm(120)],
      availablePeriods: ["5yr", "25yr", "100yr"],
    });
    expect(typhoon.enabled).toBe(true);
    expect(typhoon.returnPeriod).toBe("25yr");
    expect(typhoon.threatTier).toBe(2);

    const superTyphoon = computeFloodAutomation({
      forecast: quietForecast,
      alerts: [],
      typhoons: [storm(190)],
      availablePeriods: ["5yr", "25yr", "100yr"],
    });
    expect(superTyphoon.returnPeriod).toBe("100yr");
    expect(superTyphoon.threatTier).toBe(3);
  });
});
