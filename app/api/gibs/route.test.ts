/** @jest-environment node */

describe("/api/gibs", () => {
  it("returns static GIBS metadata for the client", async () => {
    const { GET } = await import("./route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      base:
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png",
      layers: {
        "himawari-true": {
          id: "AHI_Geocolor",
          label: "Himawari True Color",
        },
        "himawari-ir": {
          id: "AHI_Band13_Clean_Infrared_Brightness_Temperature",
          label: "Himawari Infrared",
        },
      },
      attribution: "NASA GIBS / Himawari-9",
    });
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});
