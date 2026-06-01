/** @jest-environment jsdom */
export {};

import {
  applyLiveWeatherDeviceTier,
  destroyLiveWeatherOverlay,
  initLiveWeatherOverlay,
  notifyLiveWeatherMapMode,
  setLiveWeatherOverlayActive,
  setLiveWeatherPerformanceProfile,
  TYPHOON_FOCUS_EVENT,
  PAR_STORMS_EVENT,
} from "./live-weather-overlay";
import { createMapStub, createWindFieldPayload } from "@/test/helpers/map-stub";
import { installDeviceSignals } from "@/test/helpers/device-env";
import { installCanvas2dShim } from "@/test/helpers/canvas-2d-shim";

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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => createWindFieldPayload(),
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

  it("is idempotent when init is called twice on the same map", () => {
    const map = createMapStub();
    initLiveWeatherOverlay(map);
    initLiveWeatherOverlay(map);
    expect(map.getContainer().querySelectorAll("canvas")).toHaveLength(1);
    destroyLiveWeatherOverlay(map);
  });

  it("pauses wind when overlay is deactivated and restores when active", async () => {
    const map = initMapWithOverlay();
    await Promise.resolve();
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.style.opacity).toBe("1");

    setLiveWeatherOverlayActive(map, false);
    expect(canvas.style.opacity).toBe("0");

    setLiveWeatherOverlayActive(map, true);
    expect(canvas.style.opacity).toBe("1");
    destroyLiveWeatherOverlay(map);
  });

  it("ignores redundant overlay deactivation", () => {
    const map = initMapWithOverlay();
    setLiveWeatherOverlayActive(map, false);
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;
    setLiveWeatherOverlayActive(map, false);
    expect(canvas.style.opacity).toBe("0");
    destroyLiveWeatherOverlay(map);
  });

  it("no-ops overlay APIs when map is null", () => {
    expect(() => setLiveWeatherOverlayActive(null, false)).not.toThrow();
    expect(() => applyLiveWeatherDeviceTier(null)).not.toThrow();
    expect(() => setLiveWeatherPerformanceProfile(null, "performance")).not.toThrow();
  });

  it("hides wind in 3d and restores in 2d when overlay is active", async () => {
    const map = initMapWithOverlay();
    await Promise.resolve();
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;

    notifyLiveWeatherMapMode(map, "3d");
    expect(canvas.style.opacity).toBe("0");

    notifyLiveWeatherMapMode(map, "2d");
    expect(canvas.style.opacity).toBe("1");
    destroyLiveWeatherOverlay(map);
  });

  it("keeps wind hidden in 2d when overlay stays inactive", async () => {
    const map = initMapWithOverlay();
    await Promise.resolve();
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;

    setLiveWeatherOverlayActive(map, false);
    notifyLiveWeatherMapMode(map, "3d");
    notifyLiveWeatherMapMode(map, "2d");
    expect(canvas.style.opacity).toBe("0");
    destroyLiveWeatherOverlay(map);
  });

  it("applies device tier repeatedly without error", () => {
    const map = initMapWithOverlay();
    applyLiveWeatherDeviceTier(map, "low");
    applyLiveWeatherDeviceTier(map, "low");
    destroyLiveWeatherOverlay(map);
  });

  it("skips duplicate performance profile assignment", async () => {
    const map = initMapWithOverlay();
    await Promise.resolve();
    setLiveWeatherPerformanceProfile(map, "performance");
    const canvas = map.getContainer().querySelector("canvas") as HTMLCanvasElement;
    setLiveWeatherPerformanceProfile(map, "performance");
    expect(canvas).toBeTruthy();
    destroyLiveWeatherOverlay(map);
  });

  it("handles typhoon focus and PAR storm custom events", async () => {
    const map = initMapWithOverlay();
    await Promise.resolve();
    const storm = {
      id: "s1",
      name: "STORM",
      category: "TY",
      position: [125, 14] as [number, number],
      windKph: 100,
      pressureHpa: 990,
      bestTrack: [],
      forecast: [],
    };
    window.dispatchEvent(
      new CustomEvent(PAR_STORMS_EVENT, { detail: { storms: [storm] } }),
    );
    window.dispatchEvent(
      new CustomEvent(TYPHOON_FOCUS_EVENT, { detail: { storm } }),
    );
    destroyLiveWeatherOverlay(map);
  });

  it("destroys overlay and wind canvas on map remove", async () => {
    const map = initMapWithOverlay();
    await Promise.resolve();
    map.emit("remove");
    expect(map.getContainer().querySelector("canvas")).toBeNull();
  });
});
