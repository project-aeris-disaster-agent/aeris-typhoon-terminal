import { computeForecastAlert, type ForecastSummary } from "./forecast";

function mockSummary(partial: Partial<ForecastSummary> & { daily?: ForecastSummary["daily"] }): ForecastSummary {
  const daily = partial.daily ?? [
    {
      date: "2026-05-05",
      tempMin: 26,
      tempMax: 32,
      rainMm: 1,
      windKph: 15,
      pressureHpa: 1010,
    },
  ];
  return {
    maxWindKph: partial.maxWindKph ?? Math.max(...daily.map((d) => d.windKph)),
    totalRainMm: partial.totalRainMm ?? daily.reduce((s, d) => s + d.rainMm, 0),
    minPressureHpa: partial.minPressureHpa ?? Math.min(...daily.map((d) => d.pressureHpa)),
    daily,
  };
}

describe("computeForecastAlert", () => {
  it("returns Low for mild tropical week", () => {
    const s = mockSummary({
      daily: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-05-0${i + 1}`,
        tempMin: 26,
        tempMax: 32,
        rainMm: 0.5,
        windKph: 14,
        pressureHpa: 1010,
      })),
    });
    const a = computeForecastAlert(s);
    expect(a.level).toBe(0);
    expect(a.tone).toBe("ok");
  });

  it("elevates score for extreme heat", () => {
    const s = mockSummary({
      daily: [
        {
          date: "2026-05-05",
          tempMin: 28,
          tempMax: 38,
          rainMm: 0,
          windKph: 12,
          pressureHpa: 1010,
        },
      ],
    });
    const a = computeForecastAlert(s);
    expect(a.score).toBeGreaterThanOrEqual(12);
    expect(a.level).toBeGreaterThanOrEqual(1);
  });

  it("elevates score for heavy rain spike", () => {
    const s = mockSummary({
      daily: [
        {
          date: "2026-05-05",
          tempMin: 26,
          tempMax: 30,
          rainMm: 45,
          windKph: 20,
          pressureHpa: 1008,
        },
      ],
    });
    const a = computeForecastAlert(s);
    expect(a.level).toBeGreaterThanOrEqual(2);
  });
});
