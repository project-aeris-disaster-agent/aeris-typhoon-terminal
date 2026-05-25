/** @jest-environment node */

describe("/api/gibs", () => {
  it("returns GIBS metadata derived from the runtime GIBS_WMTS constant", async () => {
    const { GET } = await import("./route");
    const { GIBS_WMTS } = await import("@/services/satellite-frames");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attribution).toBe("NASA GIBS / Himawari-9");
    expect(body.projection).toBe("EPSG:3857");
    expect(body.publishLagMinutes).toBe(35);
    expect(typeof body.tileUrlTemplate).toBe("string");
    expect(body.tileUrlTemplate).toContain("{layerId}");
    expect(body.tileUrlTemplate).toContain("{time}");
    expect(body.tileUrlTemplate).toContain("{tileMatrixSet}");

    expect(Object.keys(body.layers).sort()).toEqual(
      Object.keys(GIBS_WMTS).sort(),
    );
    for (const [key, spec] of Object.entries(GIBS_WMTS)) {
      expect(body.layers[key]).toEqual({
        id: spec.layerId,
        tileMatrixSet: spec.matrix,
        maxZoom: spec.maxzoom,
        label: spec.label,
      });
    }

    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});
