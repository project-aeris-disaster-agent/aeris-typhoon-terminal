/** @jest-environment node */
export {};

import {
  combinedWindMs,
  findLpaSeeds,
  lpaSeedsForField,
  pointInPar,
  rankineWindMs,
} from "./wind-flow-model";
import type { WindFieldPayload } from "./wind-field-types";
import type { Typhoon } from "./typhoon-tracks";

function gridField(
  overrides: Partial<WindFieldPayload> & Pick<WindFieldPayload, "width" | "height">,
): WindFieldPayload {
  const { width: w, height: h } = overrides;
  const n = w * h;
  return {
    west: 118,
    south: 8,
    east: 128,
    north: 18,
    u: new Array(n).fill(0),
    v: new Array(n).fill(0),
    p: new Array(n).fill(1012),
    generatedAt: "",
    ...overrides,
  };
}

const sampleStorm: Typhoon = {
  id: "t1",
  name: "TEST",
  category: "TY",
  position: [122, 11.5],
  windKph: 120,
  pressureHpa: 980,
  bestTrack: [],
  forecast: [],
};

describe("pointInPar", () => {
  it("returns true for a point well inside PAR", () => {
    expect(pointInPar(125, 14)).toBe(true);
  });

  it("returns false far outside PAR", () => {
    expect(pointInPar(108, 14)).toBe(false);
  });

  it("returns false at the equator west of the basin", () => {
    expect(pointInPar(100, 0)).toBe(false);
  });
});

describe("rankineWindMs", () => {
  it("produces cyclonic flow east of the centre (NH)", () => {
    const { u, v } = rankineWindMs(126, 15, 125, 15, 20, 150_000);
    expect(v).toBeGreaterThan(2);
    expect(Math.abs(u)).toBeLessThan(Math.abs(v));
  });

  it("returns calm wind inside the eye radius", () => {
    const { u, v } = rankineWindMs(125.001, 15, 125, 15, 40, 150_000);
    expect(u).toBe(0);
    expect(v).toBe(0);
  });

  it("decays with distance outside the core", () => {
    const near = rankineWindMs(125.5, 15, 125, 15, 30, 120_000);
    const far = rankineWindMs(128, 15, 125, 15, 30, 120_000);
    expect(Math.hypot(near.u, near.v)).toBeGreaterThan(Math.hypot(far.u, far.v));
  });
});

describe("findLpaSeeds", () => {
  it("detects a synthetic pressure low inside PAR", () => {
    const w = 8;
    const h = 6;
    const p: number[] = new Array(w * h).fill(1012);
    const idx = 3 + 2 * w;
    p[idx] = 1004;
    for (const d of [-1, 1, -w, w, -w - 1, w + 1, -w + 1, w - 1]) {
      const j = idx + d;
      if (j >= 0 && j < p.length) p[j] = 1011;
    }
    const field = gridField({ width: w, height: h, p });
    const seeds = findLpaSeeds(field);
    expect(seeds.length).toBeGreaterThanOrEqual(1);
    expect(seeds[0].strengthHpa).toBeGreaterThan(0.55);
    expect(pointInPar(seeds[0].lng, seeds[0].lat)).toBe(true);
  });

  it("returns empty when pressure grid length mismatches", () => {
    const field = gridField({ width: 4, height: 3, p: [1, 2, 3] });
    expect(findLpaSeeds(field)).toEqual([]);
  });

  it("returns empty when pressure grid is missing", () => {
    const field = gridField({ width: 4, height: 3, p: undefined });
    expect(findLpaSeeds(field)).toEqual([]);
  });

  it("returns at most four seeds and prefers stronger lows first", () => {
    const w = 12;
    const h = 10;
    const p = new Array(w * h).fill(1012);
    const lows = [
      [2, 2],
      [8, 2],
      [2, 7],
      [8, 7],
      [5, 4],
    ];
    for (const [col, row] of lows) {
      const idx = row * w + col;
      p[idx] = 1003;
      for (const [dc, dr] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const j = (row + dr) * w + (col + dc);
        if (j >= 0 && j < p.length) p[j] = 1010;
      }
    }
    const seeds = findLpaSeeds(gridField({ width: w, height: h, p }));
    expect(seeds.length).toBeLessThanOrEqual(4);
    if (seeds.length >= 2) {
      expect(seeds[0].strengthHpa).toBeGreaterThanOrEqual(seeds[1].strengthHpa);
    }
  });
});

describe("lpaSeedsForField", () => {
  it("returns empty when field is null", () => {
    expect(lpaSeedsForField(null)).toEqual([]);
  });

  it("returns empty when field has no pressure component", () => {
    expect(lpaSeedsForField(gridField({ width: 2, height: 2, p: undefined }))).toEqual(
      [],
    );
  });

  it("matches findLpaSeeds for a valid field", () => {
    const field = gridField({ width: 8, height: 6 });
    expect(lpaSeedsForField(field)).toEqual(findLpaSeeds(field));
  });
});

describe("combinedWindMs", () => {
  const baseField = gridField({
    width: 4,
    height: 3,
    west: 120,
    south: 10,
    east: 124,
    north: 13,
    u: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    v: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    p: new Array(12).fill(1010),
  });

  it("adds cyclonic flow when a storm is present", () => {
    const lng = 122.35;
    const lat = 11.52;
    const withSt = combinedWindMs(lng, lat, baseField, [sampleStorm]);
    const noSt = combinedWindMs(lng, lat, baseField, []);
    expect(Math.hypot(withSt.u, withSt.v)).toBeGreaterThan(
      Math.hypot(noSt.u, noSt.v) + 0.5,
    );
  });

  it("returns synoptic background only when no storms and no LPAs apply", () => {
    const out = combinedWindMs(122, 11.5, baseField, []);
    expect(out.u).toBeCloseTo(2, 5);
    expect(out.v).toBeCloseTo(0, 5);
  });

  it("returns zero wind without field or storms", () => {
    const out = combinedWindMs(122, 11.5, null, []);
    expect(out.u).toBe(0);
    expect(out.v).toBe(0);
  });

  it("uses precomputed LPA seeds identically to on-demand discovery", () => {
    const w = 8;
    const h = 6;
    const p: number[] = new Array(w * h).fill(1012);
    const idx = 3 + 2 * w;
    p[idx] = 1004;
    for (const d of [-1, 1, -w, w]) {
      const j = idx + d;
      if (j >= 0) p[j] = 1011;
    }
    const field = gridField({ width: w, height: h, p });
    const seeds = findLpaSeeds(field);
    const lng = seeds[0]?.lng ?? 125;
    const lat = seeds[0]?.lat ?? 14;
    const cached = combinedWindMs(lng, lat, field, [], seeds);
    const fresh = combinedWindMs(lng, lat, field, []);
    expect(cached.u).toBeCloseTo(fresh.u, 10);
    expect(cached.v).toBeCloseTo(fresh.v, 10);
  });

  it("clamps blended vortex contribution to the synoptic background cap", () => {
    const storms = Array.from({ length: 6 }, (_, i) => ({
      ...sampleStorm,
      id: `t${i}`,
      position: [120 + i * 0.4, 11 + i * 0.2] as [number, number],
    }));
    const out = combinedWindMs(122, 11.5, baseField, storms);
    const bg = combinedWindMs(122, 11.5, baseField, []);
    const maxDelta = Math.hypot(out.u - bg.u, out.v - bg.v);
    expect(maxDelta).toBeLessThan(60);
    expect(Number.isFinite(out.u)).toBe(true);
    expect(Number.isFinite(out.v)).toBe(true);
  });

  it("samples bilinear values at the grid center", () => {
    const field = gridField({
      width: 3,
      height: 3,
      west: 0,
      south: 0,
      east: 2,
      north: 2,
      u: [0, 0, 0, 0, 12, 0, 0, 0, 0],
      v: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    const out = combinedWindMs(1, 1, field, []);
    expect(out.u).toBeCloseTo(12, 5);
    expect(out.v).toBeCloseTo(0, 5);
  });
});
