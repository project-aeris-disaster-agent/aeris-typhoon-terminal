import {
  breadcrumbFromAddress,
  hitToSuggestion,
  shortNameFromAddress,
  zoomForKind,
} from "./labels";
import type { RawGeocodeHit } from "./types";

describe("shortNameFromAddress", () => {
  it("prefers house number and road for addresses", () => {
    expect(
      shortNameFromAddress(
        {
          house_number: "123",
          road: "Rizal Avenue",
          city: "Quezon City",
        },
        "fallback",
      ),
    ).toBe("123 Rizal Avenue");
  });

  it("uses road when no house number", () => {
    expect(
      shortNameFromAddress({ road: "EDSA", city: "Quezon City" }, "fallback"),
    ).toBe("EDSA");
  });

  it("falls back to suburb for admin places", () => {
    expect(
      shortNameFromAddress(
        { suburb: "Holy Spirit", city: "Quezon City" },
        "Holy Spirit, Quezon City",
      ),
    ).toBe("Holy Spirit");
  });
});

describe("breadcrumbFromAddress", () => {
  it("builds city and state trail", () => {
    expect(
      breadcrumbFromAddress({
        suburb: "Holy Spirit",
        city: "Quezon City",
        state: "Metro Manila",
      }),
    ).toBe("Holy Spirit · Quezon City · Metro Manila");
  });
});

describe("zoomForKind", () => {
  it("uses 17 for house-level addresses", () => {
    expect(zoomForKind("address", "house")).toBe(17);
  });

  it("uses 16 for street-level addresses", () => {
    expect(zoomForKind("address", "road")).toBe(16);
  });

  it("uses 12 for cities", () => {
    expect(zoomForKind("place", "city")).toBe(12);
  });
});

describe("hitToSuggestion", () => {
  it("classifies nominatim address hits", () => {
    const hit: RawGeocodeHit = {
      id: "nominatim:1",
      lat: 14.65,
      lon: 121.03,
      displayName: "123 Rizal Avenue, Quezon City, Philippines",
      osmClass: "building",
      osmType: "house",
      address: {
        house_number: "123",
        road: "Rizal Avenue",
        city: "Quezon City",
      },
      source: "nominatim",
    };
    const s = hitToSuggestion(hit);
    expect(s.shortName).toBe("123 Rizal Avenue");
    expect(s.kind).toBe("address");
    expect(s.zoom).toBe(17);
  });
});
