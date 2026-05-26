/** @jest-environment node */
export {};

import {
  easeInOutCubic,
  weatherFrameHoldMs,
  WEATHER_IMAGERY_CROSSFADE_MS,
} from "./weather-animation";

describe("weather-animation", () => {
  it("eases smoothly between 0 and 1", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 1);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it("exposes crossfade and per-source hold durations", () => {
    expect(WEATHER_IMAGERY_CROSSFADE_MS).toBeGreaterThan(300);
    expect(weatherFrameHoldMs("radar")).toBeLessThan(weatherFrameHoldMs("satellite"));
  });
});
