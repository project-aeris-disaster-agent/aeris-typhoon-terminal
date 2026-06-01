/** @jest-environment node */
export {};

import {
  combinedWindMs,
  pointInPar,
  rankineWindMs,
  findLpaSeeds,
  lpaSeedsForField,
} from "./wind-flow-model";
import type { WindFieldPayload } from "./wind-field-types";

describe("pointInPar", () => {
  it("returns true for a point well inside PAR", () => {
    expect(pointInPar(125, 14)).toBe(true);
  });

  it("returns false far outside PAR", () => {
    expect(pointInPar(108, 14)).toBe(false);
  });
});

describe("rankineWindMs", () => {
  it("produces cyclonic flow east of the centre (NH)", () => {
    const { u, v } = rankineWindMs(126, 15, 125, 15, 20, 150_000);
    expect(v).toBeGreaterThan(2);
    expect(Math.abs(u)).toBeLessThan(Math.abs(v));
  });
});

describe("findLpaSeeds", () => {
  it("detects a synthetic pressure low inside PAR", () => {
    const w = 8;
    const h = 6;
    const p: number[] = new Array(w * h).fill(1012);
    const idx = 3 + 2 * w;
    p[idx] = 1004;
    for (let d of [-1, 1, -w, w, -w - 1, w + 1, -w + 1, w - 1]) {
      const j = idx + d;
      if (j >= 0 && j < p.length) p[j] = 1011;
    }
    const field: WindFieldPayload = {
      width: w,
      height: h,
      west: 118,
      south: 8,
      east: 128,
      north: 18,
      u: new Array(w * h).fill(0),
      v: new Array(w * h).fill(0),
      p,
      generatedAt: "",
    };
    const seeds = findLpaSeeds(field);
    expect(seeds.length).toBeGreaterThanOrEqual(1);
  });
});

describe("lpaSeedsForField", () => {
  it("returns empty when field is null", () => {
    expect(lpaSeedsForField(null)).toEqual([]);
  });
});

describe("combinedWindMs", () => {
  it("adds cyclonic flow at a fixed point when a storm is present", () => {
    const field: WindFieldPayload = {
      width: 4,
      height: 3,
      west: 120,
      south: 10,
      east: 124,
      north: 13,
      u: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      v: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      p: new Array(12).fill(1010),
      generatedAt: "",
    };
    const storms = [
      {
        id: "t1",
        name: "TEST",
        category: "TY",
        position: [122, 11.5] as [number, number],
        windKph: 120,
        pressureHpa: 980,
        bestTrack: [],
        forecast: [],
      },
    ];
    const lng = 122.35;
    const lat = 11.52;
    const withSt = combinedWindMs(lng, lat, field, storms);
    const noSt = combinedWindMs(lng, lat, field, []);
    expect(Math.hypot(withSt.u, withSt.v)).toBeGreaterThan(
      Math.hypot(noSt.u, noSt.v) + 0.5,
    );
  });
});
