/** @jest-environment node */
export {};

import {
  easeInOutCubic,
  weatherFrameHoldMs,
  weatherLoopEndHoldMs,
  WEATHER_IMAGERY_CROSSFADE_MS,
  WEATHER_LOOP_END_HOLD_FACTOR,
  WEATHER_LOOP_WRAP_CROSSFADE_FACTOR,
  WEATHER_FRAME_PRELOAD_LEAD_MS,
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

  it("end-of-loop hold is longer than a normal frame hold for both sources", () => {
    expect(WEATHER_LOOP_END_HOLD_FACTOR).toBeGreaterThan(1);
    expect(weatherLoopEndHoldMs("radar")).toBeGreaterThan(weatherFrameHoldMs("radar"));
    expect(weatherLoopEndHoldMs("satellite")).toBeGreaterThan(
      weatherFrameHoldMs("satellite"),
    );
  });

  it("loop-wrap crossfade stretches the normal crossfade duration", () => {
    expect(WEATHER_LOOP_WRAP_CROSSFADE_FACTOR).toBeGreaterThan(1);
  });

  it("preload lead time leaves headroom before the advance", () => {
    expect(WEATHER_FRAME_PRELOAD_LEAD_MS).toBeGreaterThan(0);
    // Lead must be smaller than the shorter (radar) hold or we would preload
    // before the previous crossfade even completes.
    expect(WEATHER_FRAME_PRELOAD_LEAD_MS).toBeLessThan(weatherFrameHoldMs("radar"));
  });
});
