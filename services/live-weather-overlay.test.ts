/** @jest-environment jsdom */
export {};

import {
  applyLiveWeatherDeviceTier,
  destroyLiveWeatherOverlay,
  initLiveWeatherOverlay,
  isImageryRefreshTimerRunning,
  isLiveWeatherTickerRunning,
  notifyLiveWeatherMapMode,
  setLiveWeatherOverlayActive,
  setLiveWeatherPerformanceProfile,
  TYPHOON_FOCUS_EVENT,
} from "./live-weather-overlay";
import { createMapStub } from "@/test/helpers/map-stub";
import { installDeviceSignals } from "@/test/helpers/device-env";
import { installCanvas2dShim } from "@/test/helpers/canvas-2d-shim";

const mockFetchRadarFrames = jest.fn();
const mockEnsureRadarLayer = jest.fn();
const mockFetchSatelliteFrames = jest.fn();

jest.mock("@/services/satellite-frames", () => {
  const actual = jest.requireActual<typeof import("@/services/satellite-frames")>(
    "@/services/satellite-frames",
  );
  return {
    ...actual,
    fetchRadarFrames: (...args: unknown[]) => mockFetchRadarFrames(...args),
    ensureRadarLayer: (...args: unknown[]) => mockEnsureRadarLayer(...args),
    fetchSatelliteFrames: (...args: unknown[]) => mockFetchSatelliteFrames(...args),
  };
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("live-weather-overlay", () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    installCanvas2dShim();
  });

  beforeEach(() => {
    installDeviceSignals({ coarse: false, devicePixelRatio: 1 });
    mockFetchRadarFrames.mockResolvedValue({
      frames: [{ time: "2026-06-01T12:00:00Z", path: "/radar/0" }],
    });
    mockFetchSatelliteFrames.mockResolvedValue({ frames: [] });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function initMapWithOverlay() {
    const map = createMapStub();
    initLiveWeatherOverlay(map);
    return map;
  }

  it("is idempotent when init is called twice on the same map", async () => {
    const map = createMapStub();
    initLiveWeatherOverlay(map);
    initLiveWeatherOverlay(map);
    await flushMicrotasks();
    expect(isImageryRefreshTimerRunning(map)).toBe(true);
    destroyLiveWeatherOverlay(map);
  });

  it("stops imagery refresh timers when overlay is deactivated", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    expect(isImageryRefreshTimerRunning(map)).toBe(true);

    setLiveWeatherOverlayActive(map, false);
    expect(isImageryRefreshTimerRunning(map)).toBe(false);

    setLiveWeatherOverlayActive(map, true);
    await flushMicrotasks();
    expect(isImageryRefreshTimerRunning(map)).toBe(true);
    destroyLiveWeatherOverlay(map);
  });

  it("stops the weather ticker when overlay is deactivated", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    expect(isLiveWeatherTickerRunning(map)).toBe(true);

    setLiveWeatherOverlayActive(map, false);
    expect(isLiveWeatherTickerRunning(map)).toBe(false);

    setLiveWeatherOverlayActive(map, true);
    await flushMicrotasks();
    expect(isLiveWeatherTickerRunning(map)).toBe(true);
    destroyLiveWeatherOverlay(map);
  });

  it("does not restart ticker on typhoon focus when overlay is inactive", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    setLiveWeatherOverlayActive(map, false);
    expect(isLiveWeatherTickerRunning(map)).toBe(false);

    window.dispatchEvent(
      new CustomEvent(TYPHOON_FOCUS_EVENT, {
        detail: {
          storm: {
            id: "s1",
            name: "STORM",
            category: "TY",
            position: [125, 14] as [number, number],
            windKph: 100,
            pressureHpa: 990,
            bestTrack: [],
            forecast: [],
          },
        },
      }),
    );
    expect(isLiveWeatherTickerRunning(map)).toBe(false);
    destroyLiveWeatherOverlay(map);
  });

  it("no-ops overlay APIs when map is null", () => {
    expect(() => setLiveWeatherOverlayActive(null, false)).not.toThrow();
    expect(() => applyLiveWeatherDeviceTier(null)).not.toThrow();
    expect(() => setLiveWeatherPerformanceProfile(null, "performance")).not.toThrow();
  });

  it("stops the ticker in 3d and restores it in 2d when overlay is active", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();

    notifyLiveWeatherMapMode(map, "3d");
    expect(isLiveWeatherTickerRunning(map)).toBe(false);

    notifyLiveWeatherMapMode(map, "2d");
    await flushMicrotasks();
    expect(isLiveWeatherTickerRunning(map)).toBe(true);
    destroyLiveWeatherOverlay(map);
  });

  it("applies device tier without throwing", () => {
    const map = initMapWithOverlay();
    applyLiveWeatherDeviceTier(map, "low");
    destroyLiveWeatherOverlay(map);
  });

  it("stops timers and ticker on map remove", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    map.emit("remove");
    expect(isLiveWeatherTickerRunning(map)).toBe(false);
    expect(isImageryRefreshTimerRunning(map)).toBe(false);
  });
});
