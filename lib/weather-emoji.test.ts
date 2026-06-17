import type { ForecastSummary } from "@/lib/forecast-alert";
import { dayWeatherEmoji, forecastWeatherEmojis } from "./weather-emoji";

function mockDay(
  partial: Partial<ForecastSummary["daily"][number]> = {},
): ForecastSummary["daily"][number] {
  return {
    date: "2026-06-18",
    tempMin: 26,
    tempMax: 32,
    rainMm: 0,
    windKph: 12,
    pressureHpa: 1010,
    ...partial,
  };
}

describe("forecastWeatherEmojis", () => {
  it("returns no emojis for mild days", () => {
    const items = forecastWeatherEmojis({
      maxWindKph: 14,
      totalRainMm: 0,
      minPressureHpa: 1010,
      daily: [mockDay({ tempMax: 29 })],
    });
    expect(items).toHaveLength(0);
  });

  it("surfaces rain, heat, and wind with intensity tiers", () => {
    const items = forecastWeatherEmojis({
      maxWindKph: 48,
      totalRainMm: 55,
      minPressureHpa: 1000,
      daily: [
        mockDay({ tempMax: 38, rainMm: 42, windKph: 48 }),
        mockDay({ date: "2026-06-19", tempMax: 34, rainMm: 8, windKph: 20 }),
      ],
    });
    expect(items.map((i) => i.emoji)).toEqual(expect.arrayContaining(["⛈️", "🔥", "💨"]));
    expect(items.every((i) => i.intensity === 3)).toBe(true);
  });
});

describe("dayWeatherEmoji", () => {
  it("prioritizes the strongest hazard for a single day", () => {
    const item = dayWeatherEmoji(
      mockDay({ tempMax: 36, rainMm: 22, windKph: 18 }),
    );
    expect(item.emoji).toBe("🌧️");
    expect(item.intensity).toBe(3);
  });

  it("falls back to fair weather when nothing notable", () => {
    const item = dayWeatherEmoji(mockDay({ tempMax: 29, rainMm: 0, windKph: 10 }));
    expect(item.emoji).toBe("🌤️");
  });
});
