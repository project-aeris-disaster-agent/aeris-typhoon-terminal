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
  PAR_STORMS_EVENT,
} from "./live-weather-overlay";
import { createMapStub, createWindFieldPayload } from "@/test/helpers/map-stub";
import { installDeviceSignals } from "@/test/helpers/device-env";
import { installCanvas2dShim } from "@/test/helpers/canvas-2d-shim";
import type { Canvas2dShimContext } from "@/test/helpers/canvas-2d-shim";

const mockFetchRadarFrames = jest.fn();
const mockEnsureRadarLayer = jest.fn();

jest.mock("@/services/satellite-frames", () => {
  const actual = jest.requireActual<typeof import("@/services/satellite-frames")>(
    "@/services/satellite-frames",
  );
  return {
    ...actual,
    fetchRadarFrames: (...args: unknown[]) => mockFetchRadarFrames(...args),
    ensureRadarLayer: (...args: unknown[]) => mockEnsureRadarLayer(...args),
  };
});

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("live-weather-overlay", () => {
  const originalFetch = global.fetch;
  let windFetch: jest.Mock;

  beforeAll(() => {
    installCanvas2dShim();
  });

  beforeEach(() => {
    installDeviceSignals({ coarse: false, devicePixelRatio: 1 });
    mockFetchRadarFrames.mockResolvedValue({
      frames: [{ time: "2026-06-01T12:00:00Z", path: "/radar/0" }],
    });
    windFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => createWindFieldPayload(),
    });
    global.fetch = windFetch as typeof fetch;
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

  it("is idempotent when init is called twice on the same map", () => {
    const map = createMapStub();
    initLiveWeatherOverlay(map);
    initLiveWeatherOverlay(map);
    expect(map.getContainer().querySelectorAll("canvas")).toHaveLength(1);
    destroyLiveWeatherOverlay(map);
  });

  it("pauses wind when overlay is deactivated and restores when active", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.style.opacity).toBe("1");

    setLiveWeatherOverlayActive(map, false);
    expect(canvas.style.opacity).toBe("0");

    setLiveWeatherOverlayActive(map, true);
    expect(canvas.style.opacity).toBe("1");
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

  it("fetches wind field on init", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    expect(windFetch).toHaveBeenCalledWith("/api/wind-field", { cache: "no-store" });
    destroyLiveWeatherOverlay(map);
  });

  it("warns when wind-field payload fails validation", async () => {
    windFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        error: "bad",
        width: 1,
        height: 1,
        u: [],
        v: [],
        p: [],
      }),
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const map = initMapWithOverlay();
    await flushMicrotasks();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("wind-field payload rejected"),
      expect.anything(),
    );
    warn.mockRestore();
    destroyLiveWeatherOverlay(map);
  });

  it("no-ops overlay APIs when map is null", () => {
    expect(() => setLiveWeatherOverlayActive(null, false)).not.toThrow();
    expect(() => applyLiveWeatherDeviceTier(null)).not.toThrow();
    expect(() => setLiveWeatherPerformanceProfile(null, "performance")).not.toThrow();
  });

  it("hides wind in 3d and restores in 2d when overlay is active", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;

    notifyLiveWeatherMapMode(map, "3d");
    expect(canvas.style.opacity).toBe("0");
    expect(isLiveWeatherTickerRunning(map)).toBe(false);

    notifyLiveWeatherMapMode(map, "2d");
    expect(canvas.style.opacity).toBe("1");
    await flushMicrotasks();
    expect(isLiveWeatherTickerRunning(map)).toBe(true);
    destroyLiveWeatherOverlay(map);
  });

  it("applies device tier without throwing", () => {
    const map = initMapWithOverlay();
    applyLiveWeatherDeviceTier(map, "low");
    destroyLiveWeatherOverlay(map);
  });

  it("dispatches PAR storm events to wind layer", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    window.dispatchEvent(
      new CustomEvent(PAR_STORMS_EVENT, { detail: { storms: [] } }),
    );
    destroyLiveWeatherOverlay(map);
  });

  it("destroys overlay and wind canvas on map remove", async () => {
    const map = initMapWithOverlay();
    await flushMicrotasks();
    map.emit("remove");
    expect(map.getContainer().querySelector("canvas")).toBeNull();
    expect(isLiveWeatherTickerRunning(map)).toBe(false);
  });
});
