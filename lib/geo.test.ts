import { haversineKm, parseLatLonFromText } from "@/lib/geo";

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm({ lat: 14.6, lon: 121 }, { lat: 14.6, lon: 121 })).toBe(0);
  });

  it("Manila to Cebu is roughly 570 km", () => {
    const manila = { lat: 14.5995, lon: 120.9842 };
    const cebu = { lat: 10.3157, lon: 123.8854 };
    const km = haversineKm(manila, cebu);
    expect(km).toBeGreaterThan(540);
    expect(km).toBeLessThan(620);
  });
});

describe("parseLatLonFromText", () => {
  it("parses PAGASA-style coordinates", () => {
    const got = parseLatLonFromText(
      "LOCATION: 1,260 KM EAST OF EASTERN VISAYAS (10.0°N, 137.2°E)",
    );
    expect(got).toEqual({ lat: 10, lon: 137.2 });
  });

  it("handles southern/western hemispheres", () => {
    expect(parseLatLonFromText("12.5°S, 130.0°W")).toEqual({ lat: -12.5, lon: -130 });
  });

  it("returns null when no coordinates are present", () => {
    expect(parseLatLonFromText("no coords here")).toBeNull();
  });

  it("parses HTML degree entities from PAGASA markup", () => {
    expect(
      parseLatLonFromText(
        "1,260 KM EAST OF EASTERN VISAYAS (10.0&deg;N, 137.2&deg;E)",
      ),
    ).toEqual({ lat: 10, lon: 137.2 });
  });
});
