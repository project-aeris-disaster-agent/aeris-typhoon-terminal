import { mergeGeocodeHits } from "./merge";
import type { RawGeocodeHit } from "./types";

function placeHit(
  id: string,
  lat: number,
  lon: number,
  name: string,
): RawGeocodeHit {
  return {
    id,
    lat,
    lon,
    displayName: `${name}, Philippines`,
    osmClass: "place",
    osmType: "suburb",
    address: { suburb: name, city: "Test City" },
    source: "nominatim",
  };
}

function addressHit(
  id: string,
  lat: number,
  lon: number,
  road: string,
): RawGeocodeHit {
  return {
    id,
    lat,
    lon,
    displayName: `${road}, Test City, Philippines`,
    osmClass: "highway",
    osmType: "residential",
    address: { road, city: "Test City" },
    source: "photon",
  };
}

describe("mergeGeocodeHits", () => {
  it("interleaves places and addresses in the first 10", () => {
    const places = Array.from({ length: 8 }, (_, i) =>
      placeHit(`p${i}`, 14.6 + i * 0.001, 121.0, `Barangay ${i}`),
    );
    const addresses = Array.from({ length: 8 }, (_, i) =>
      addressHit(`a${i}`, 14.7 + i * 0.001, 121.1, `Rizal Street ${i}`),
    );
    const merged = mergeGeocodeHits("rizal", [...places, ...addresses]);
    expect(merged.length).toBeLessThanOrEqual(10);
    const kinds = new Set(merged.map((s) => s.kind));
    expect(kinds.has("place")).toBe(true);
    expect(kinds.has("address")).toBe(true);
  });

  it("dedupes results at the same coordinates with similar names", () => {
    const a = addressHit("a1", 14.6, 121.0, "Rizal Avenue");
    const b = addressHit("a2", 14.60001, 121.00001, "Rizal Avenue");
    const merged = mergeGeocodeHits("rizal avenue", [a, b]);
    const rizal = merged.filter((s) =>
      s.shortName.toLowerCase().includes("rizal"),
    );
    expect(rizal.length).toBe(1);
  });
});
