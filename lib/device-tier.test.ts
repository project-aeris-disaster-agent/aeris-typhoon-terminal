/** @jest-environment jsdom */
export {};

import {
  windParticleCountForTier,
  windDprCapForTier,
  mapDprCapForTier,
  overlayProfileForTier,
  mapModeFromUrl,
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
    expect(overlayProfileForTier("low")).toBe("performance");
  });

  it("drops 3d from URL on coarse-pointer devices", () => {
    const matchMedia = jest.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, "matchMedia", { value: matchMedia, configurable: true });
    expect(mapModeFromUrl("3d")).toBeUndefined();
    expect(mapModeFromUrl("2d")).toBe("2d");
  });
});
