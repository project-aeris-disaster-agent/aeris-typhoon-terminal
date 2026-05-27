import { clipViewboxToPh } from "./types";

const PH: [number, number, number, number] = [116, 4.5, 127, 21.5];

describe("clipViewboxToPh", () => {
  it("clips map bounds wider than PH_BBOX", () => {
    const clipped = clipViewboxToPh(
      { west: 114, south: 4, east: 130, north: 22 },
      PH,
    );
    expect(clipped).toEqual({
      west: 116,
      south: 4.5,
      east: 127,
      north: 21.5,
    });
  });

  it("returns null when viewbox does not overlap PH", () => {
    expect(
      clipViewboxToPh({ west: 0, south: 0, east: 10, north: 10 }, PH),
    ).toBeNull();
  });
});
