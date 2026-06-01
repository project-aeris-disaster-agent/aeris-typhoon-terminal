/** @jest-environment jsdom */
export {};

import {
  applyDeviceTierToMap,
  detectDeviceTier,
  isCoarsePointerDevice,
  mapDprCapForTier,
  mapModeFromUrl,
  overlayProfileForTier,
  windDprCapForTier,
  windParticleCountForTier,
} from "./device-tier";
import { installDeviceSignals } from "@/test/helpers/device-env";
import { createMapStub } from "@/test/helpers/map-stub";

describe("device-tier", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("tier table accessors", () => {
    it.each([
      ["low", 1470, 1.25, 1.5, "performance"],
      ["mid", 2200, 1.5, 1.75, "performance"],
      ["high", 2940, 2, 2, "balanced"],
    ] as const)(
      "%s tier exposes expected particles, DPR caps, and profile",
      (tier, particles, windDpr, mapDpr, profile) => {
        expect(windParticleCountForTier(tier)).toBe(particles);
        expect(windDprCapForTier(tier)).toBe(windDpr);
        expect(mapDprCapForTier(tier)).toBe(mapDpr);
        expect(overlayProfileForTier(tier)).toBe(profile);
      },
    );
  });

  describe("detectDeviceTier", () => {
    it("classifies fine-pointer desktops with 8+ cores and 8+ GiB as high", () => {
      installDeviceSignals({ coarse: false, cores: 12, deviceMemory: 16 });
      expect(detectDeviceTier()).toBe("high");
    });

    it("classifies fine-pointer with modest hardware as mid", () => {
      installDeviceSignals({ coarse: false, cores: 4, deviceMemory: 4 });
      expect(detectDeviceTier()).toBe("mid");
    });

    it("classifies touch devices with low memory as low", () => {
      installDeviceSignals({ coarse: true, cores: 8, deviceMemory: 2 });
      expect(detectDeviceTier()).toBe("low");
    });

    it("classifies touch devices with few cores as low", () => {
      installDeviceSignals({ coarse: true, cores: 2, deviceMemory: 8 });
      expect(detectDeviceTier()).toBe("low");
    });

    it("classifies touch devices with small viewport as low", () => {
      installDeviceSignals({
        coarse: true,
        cores: 8,
        deviceMemory: 8,
        innerWidth: 390,
        innerHeight: 700,
      });
      expect(detectDeviceTier()).toBe("low");
    });

    it("classifies capable touch tablets as mid when memory and cores are strong", () => {
      installDeviceSignals({
        coarse: true,
        cores: 8,
        deviceMemory: 8,
        innerWidth: 1024,
        innerHeight: 768,
      });
      expect(detectDeviceTier()).toBe("mid");
    });

    it("treats missing deviceMemory on fine-pointer as high when cores are 8+", () => {
      installDeviceSignals({ coarse: false, cores: 8 });
      expect(detectDeviceTier()).toBe("high");
    });
  });

  describe("isCoarsePointerDevice", () => {
    it("reflects matchMedia coarse pointer query", () => {
      installDeviceSignals({ coarse: true });
      expect(isCoarsePointerDevice()).toBe(true);
      installDeviceSignals({ coarse: false });
      expect(isCoarsePointerDevice()).toBe(false);
    });
  });

  describe("mapModeFromUrl", () => {
    it("returns undefined for null and undefined modes", () => {
      installDeviceSignals({ coarse: false });
      expect(mapModeFromUrl(null)).toBeUndefined();
      expect(mapModeFromUrl(undefined)).toBeUndefined();
    });

    it("passes 2d through on touch devices", () => {
      installDeviceSignals({ coarse: true });
      expect(mapModeFromUrl("2d")).toBe("2d");
    });

    it("blocks 3d on touch until user opts in via toggle", () => {
      installDeviceSignals({ coarse: true });
      expect(mapModeFromUrl("3d")).toBeUndefined();
    });

    it("allows 3d from URL on fine-pointer devices", () => {
      installDeviceSignals({ coarse: false });
      expect(mapModeFromUrl("3d")).toBe("3d");
    });
  });

  describe("applyDeviceTierToMap", () => {
    it("sets pixel ratio to min of device DPR and tier cap", () => {
      installDeviceSignals({ devicePixelRatio: 3 });
      const map = createMapStub();
      applyDeviceTierToMap(map, "low");
      expect(map.setPixelRatio).toHaveBeenCalledWith(1.5);
      expect(map.getPixelRatio()).toBe(1.5);
    });

    it("does not raise pixel ratio above native DPR when tier cap is higher", () => {
      installDeviceSignals({ devicePixelRatio: 1 });
      const map = createMapStub();
      applyDeviceTierToMap(map, "high");
      expect(map.setPixelRatio).toHaveBeenCalledWith(1);
    });
  });
});
