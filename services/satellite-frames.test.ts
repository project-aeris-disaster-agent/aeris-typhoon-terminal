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
  normalizeLiveImagerySource,
  GIBS_WMTS,
  getAllImageryRasterPaints,
} from "./satellite-frames";

describe("buildRadarTileUrl", () => {
  it("appends the RainViewer tile suffix and routes through the same-origin proxy", () => {
    expect(
      buildRadarTileUrl("https://tilecache.rainviewer.com/v2/radar/abc123"),
    ).toBe(
      "/api/rainviewer/tiles/v2/radar/abc123/256/{z}/{x}/{y}/2/1_1.png",
    );
  });

  it("does not double-append when the path is already an XYZ template", () => {
    expect(
      buildRadarTileUrl(
        "https://tilecache.rainviewer.com/v2/radar/1/256/{z}/{x}/{y}/2/1_1.png",
      ),
    ).toBe("/api/rainviewer/tiles/v2/radar/1/256/{z}/{x}/{y}/2/1_1.png");
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

  it("embeds distinct ten-minute times for adjacent animation frames and tags them observed", () => {
    const frames = gibsAnimationFrames(2);
    expect(frames).toHaveLength(3);
    expect(frames.every((f) => f.kind === "observed")).toBe(true);
    const a = buildGibsTileUrl("himawari-airmass", frames[0].time);
    const b = buildGibsTileUrl("himawari-airmass", frames[1].time);
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
    const airMass = buildGibsTileUrl("himawari-airmass", t);
    const ir = buildGibsTileUrl("himawari-ir", t);
    expect(airMass).toContain("Himawari_AHI_Air_Mass");
    expect(airMass).toContain("GoogleMapsCompatible_Level6");
    expect(ir).toContain("Himawari_AHI_Band13_Clean_Infrared");
    expect(ir).toContain("GoogleMapsCompatible_Level6");
  });

  it("accepts the legacy `himawari-true` source key as an alias for air mass", () => {
    expect(normalizeLiveImagerySource("himawari-true")).toBe("himawari-airmass");
    const t = "2026-04-27T06:00:00.000Z";
    expect(buildGibsTileUrl("himawari-true", t)).toBe(
      buildGibsTileUrl("himawari-airmass", t),
    );
  });
});

describe("provider zoom caps (MapLibre source maxzoom)", () => {
  it("exports radar cap and per-preset GIBS caps", () => {
    expect(RADAR_TILE_MAX_ZOOM).toBe(7);
    expect(gibsRasterMaxZoom("himawari-airmass")).toBe(6);
    expect(gibsRasterMaxZoom("himawari-ir")).toBe(6);
  });
});

describe("live weather source contracts", () => {
  it("wires Air Mass directly to GIBS and IR to the RainViewer satellite catalog", () => {
    const radar = getLiveWeatherSourceContract("radar");
    const airMass = getLiveWeatherSourceContract("himawari-airmass");
    const ir = getLiveWeatherSourceContract("himawari-ir");
    expect(radar.provider).toBe("rainviewer");
    expect(radar.supportsTransparency).toBe(true);
    expect(radar.timeStepMinutes).toBe(10);
    expect(radar.maxzoom).toBe(RADAR_TILE_MAX_ZOOM);
    expect(airMass.provider).toBe("nasa-gibs");
    expect(airMass.supportsTransparency).toBe(false);
    expect(airMass.dayNightBehavior).toBe("day-night-stable");
    expect(airMass.expectedLatencyMinutes).toBeGreaterThan(10);
    expect(ir.provider).toBe("rainviewer-satellite");
    expect(ir.dayNightBehavior).toBe("infrared");
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

describe("imagery raster paint contract", () => {
  it("never re-enables MapLibre native tile fade (JS ticker owns crossfades)", () => {
    /**
     * Regression guard: setting `raster-fade-duration` back to a non-zero
     * value reintroduces the end-of-loop disappearance because MapLibre's
     * native fade runs alongside our JS opacity blend on the same layers.
     */
    const paints = getAllImageryRasterPaints();
    expect(paints.length).toBeGreaterThan(0);
    for (const paint of paints) {
      expect(paint["raster-fade-duration"]).toBe(0);
    }
  });
});

describe("GIBS_WMTS metadata exposure", () => {
  it("exposes layer label and matrix for both presets", () => {
    expect(GIBS_WMTS["himawari-airmass"].label).toMatch(/Air Mass/i);
    expect(GIBS_WMTS["himawari-ir"].label).toMatch(/Clean IR|Band 13/i);
    expect(GIBS_WMTS["himawari-airmass"].layerId).toBe("Himawari_AHI_Air_Mass");
    expect(GIBS_WMTS["himawari-ir"].layerId).toBe(
      "Himawari_AHI_Band13_Clean_Infrared",
    );
  });
});
