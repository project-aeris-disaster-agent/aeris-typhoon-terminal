/** @jest-environment node */
export {};

import {
  windParticleCountForTier,
  windDprCapForTier,
  mapDprCapForTier,
  liveWeatherProfileForTier,
} from "./device-tier";

describe("device-tier helpers", () => {
  it("returns fewer particles on low tier", () => {
    expect(windParticleCountForTier("low")).toBeLessThan(
      windParticleCountForTier("high"),
    );
  });

  it("caps DPR lower on low tier", () => {
    expect(windDprCapForTier("low")).toBeLessThan(windDprCapForTier("high"));
    expect(mapDprCapForTier("low")).toBeLessThan(mapDprCapForTier("high"));
  });

  it("uses performance profile on low tier", () => {
    expect(liveWeatherProfileForTier("low")).toBe("performance");
  });
});
