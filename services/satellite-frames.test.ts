/** @jest-environment node */
export {};

import {
  buildRadarTileUrl,
  buildGibsTileUrl,
  formatGibsTimeParam,
  gibsAnimationFrames,
  RADAR_TILE_MAX_ZOOM,
  gibsRasterMaxZoom,
  getGibsRequestDiagnostics,
  getLiveWeatherSourceContract,
} from "./satellite-frames";

describe("buildRadarTileUrl", () => {
  it("appends RainViewer tile suffix for short hash paths", () => {
    expect(
      buildRadarTileUrl("https://tilecache.rainviewer.com/v2/radar/abc123"),
    ).toBe(
      "https://tilecache.rainviewer.com/v2/radar/abc123/256/{z}/{x}/{y}/2/1_1.png",
    );
  });

  it("does not double-append when the path is already an XYZ template", () => {
    const full =
      "https://tilecache.rainviewer.com/v2/radar/1/256/{z}/{x}/{y}/2/1_1.png";
    expect(buildRadarTileUrl(full)).toBe(full);
  });
});

describe("GIBS time and URLs", () => {
  it("floors UTC to ten-minute boundary for GIBS time param", () => {
    expect(formatGibsTimeParam(new Date("2026-04-27T12:37:45.000Z"))).toBe(
      "2026-04-27T12:30:00Z",
    );
    expect(formatGibsTimeParam(new Date("2026-04-27T12:00:00.000Z"))).toBe(
      "2026-04-27T12:00:00Z",
    );
  });

  it("embeds distinct ten-minute times for adjacent animation frames", () => {
    const frames = gibsAnimationFrames(2);
    expect(frames).toHaveLength(3);
    const a = buildGibsTileUrl("himawari-true", frames[0].time);
    const b = buildGibsTileUrl("himawari-true", frames[1].time);
    expect(a).not.toBe(b);
    expect(a).toContain("/default/");
    expect(a).toContain("GoogleMapsCompatible_Level6");
    expect(a).toMatch(/T\d{2}:\d{2}:00Z\//);
  });

  it("does not request GIBS times newer than the browse publish lag", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-15T14:00:00.000Z"));
    const url = buildGibsTileUrl("himawari-ir", "2026-06-15T14:00:00.000Z");
    expect(url).toContain("2026-06-15T13:20:00Z");
    jest.useRealTimers();
  });

  it("switches GIBS layer and tile matrix when source key changes", () => {
    const t = "2026-04-27T06:00:00.000Z";
    const vis = buildGibsTileUrl("himawari-true", t);
    const ir = buildGibsTileUrl("himawari-ir", t);
    expect(vis).toContain("Himawari_AHI_Air_Mass");
    expect(vis).toContain("GoogleMapsCompatible_Level6");
    expect(ir).toContain("Himawari_AHI_Band13_Clean_Infrared");
    expect(ir).toContain("GoogleMapsCompatible_Level6");
  });
});

describe("provider zoom caps (MapLibre source maxzoom)", () => {
  it("exports radar cap and per-preset GIBS caps", () => {
    expect(RADAR_TILE_MAX_ZOOM).toBe(7);
    expect(gibsRasterMaxZoom("himawari-true")).toBe(6);
    expect(gibsRasterMaxZoom("himawari-ir")).toBe(6);
  });
});

describe("live weather source contracts", () => {
  it("exposes explicit provider latency/step metadata per source", () => {
    const radar = getLiveWeatherSourceContract("radar");
    const airMass = getLiveWeatherSourceContract("himawari-true");
    expect(radar.provider).toBe("rainviewer");
    expect(radar.supportsTransparency).toBe(true);
    expect(radar.timeStepMinutes).toBe(10);
    expect(radar.maxzoom).toBe(RADAR_TILE_MAX_ZOOM);
    expect(airMass.provider).toBe("rainviewer-satellite");
    expect(airMass.supportsTransparency).toBe(true);
    expect(airMass.dayNightBehavior).toBe("day-night-stable");
    expect(airMass.expectedLatencyMinutes).toBeGreaterThan(10);
  });
});

describe("GIBS request diagnostics", () => {
  it("reports when requested frame time is clamped to publish lag", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-15T14:00:00.000Z"));
    const d = getGibsRequestDiagnostics("2026-06-15T14:00:00.000Z");
    expect(d.clamped).toBe(true);
    expect(d.effectiveIsoTime).toBe("2026-06-15T13:25:00.000Z");
    jest.useRealTimers();
  });
});
