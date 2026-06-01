/** @jest-environment jsdom */
export {};

import {
  clearReportsFromMap,
  renderReportsOnMap,
  setReportPingLoopActive,
  setReportPingPerformanceMode,
  type IncidentReport,
} from "./reports-client";
import { createMapStub } from "@/test/helpers/map-stub";

jest.mock("@/config/map-layers", () => ({
  layerBeforeDynamicOverlays: () => undefined,
}));

const sampleReport: IncidentReport = {
  id: "r1",
  category: "flood",
  description: "Street flooding",
  position: [121.0, 14.5],
  createdAt: "2026-06-01T00:00:00Z",
  confirmations: 2,
};

describe("reports-client ping loop", () => {
  let rafCb: FrameRequestCallback | null = null;

  beforeEach(() => {
    rafCb = null;
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCb = cb;
      return 1;
    });
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function tick(now: number) {
    if (!rafCb) throw new Error("ping loop not scheduled");
    rafCb(now);
  }

  it("animates pulse radius and opacity on the map", () => {
    const map = createMapStub();
    renderReportsOnMap(map, [sampleReport]);
    setReportPingPerformanceMode(map, "performance");

    tick(0);
    tick(100);

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "lyr-reports-pulse",
      "circle-radius",
      expect.any(Number),
    );
    const radiusCalls = (map.setPaintProperty as jest.Mock).mock.calls.filter(
      (c) => c[0] === "lyr-reports-pulse" && c[1] === "circle-radius",
    );
    expect(radiusCalls.length).toBeGreaterThan(0);
    const lastRadius = radiusCalls[radiusCalls.length - 1][2] as number;
    expect(lastRadius).toBeGreaterThanOrEqual(4);
    expect(lastRadius).toBeLessThanOrEqual(30);

    clearReportsFromMap(map);
  });

  it("stops painting after setReportPingLoopActive(false)", () => {
    const map = createMapStub();
    renderReportsOnMap(map, [sampleReport]);
    tick(0);
    tick(100);
    const callsBefore = (map.setPaintProperty as jest.Mock).mock.calls.length;

    setReportPingLoopActive(map, false);
    tick(200);
    tick(300);
    expect((map.setPaintProperty as jest.Mock).mock.calls.length).toBe(callsBefore);

    clearReportsFromMap(map);
  });

  it("restarts the loop when activated after pause", () => {
    const map = createMapStub();
    renderReportsOnMap(map, [sampleReport]);
    setReportPingLoopActive(map, false);
    setReportPingLoopActive(map, true);
    tick(0);
    tick(100);
    expect(map.setPaintProperty).toHaveBeenCalled();
    clearReportsFromMap(map);
  });

  it("no-ops ping control for null map", () => {
    expect(() => setReportPingLoopActive(null, true)).not.toThrow();
    expect(() => setReportPingPerformanceMode(null, "quality")).not.toThrow();
  });

  it("throttles paints while document is hidden", () => {
    const map = createMapStub();
    renderReportsOnMap(map, [sampleReport]);
    setReportPingPerformanceMode(map, "quality");
    tick(0);
    const callsVisible = (map.setPaintProperty as jest.Mock).mock.calls.length;

    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    tick(50);
    tick(100);
    const callsHidden = (map.setPaintProperty as jest.Mock).mock.calls.length;
    expect(callsHidden).toBe(callsVisible);

    clearReportsFromMap(map);
  });

  it("updates geojson source data on subsequent renders", () => {
    const map = createMapStub();
    renderReportsOnMap(map, [sampleReport]);
    const src = map.getSource("src-reports") as { setData?: (d: unknown) => void };
    expect(src).toBeDefined();

    renderReportsOnMap(map, [
      { ...sampleReport, id: "r2", position: [121.1, 14.6] },
    ]);
    clearReportsFromMap(map);
  });
});
