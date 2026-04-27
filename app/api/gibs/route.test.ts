/** @jest-environment node */

describe("/api/gibs", () => {
  it("returns static GIBS metadata for the client", async () => {
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      layers: {
        "himawari-true": {
          id: "Himawari_AHI_Band3_Red_Visible_1km",
          tileMatrixSet: "GoogleMapsCompatible_Level7",
          maxZoom: 6,
          label: "Himawari visible (Band 3)",
        },
        "himawari-ir": {
          id: "Himawari_AHI_Band13_Clean_Infrared",
          tileMatrixSet: "GoogleMapsCompatible_Level6",
          maxZoom: 6,
          label: "Himawari infrared (Band 13)",
        },
      },
      attribution: "NASA GIBS / Himawari-9",
    });
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});
