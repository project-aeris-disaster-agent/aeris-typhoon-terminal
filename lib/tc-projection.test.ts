/** @jest-environment node */

import { haversineKm } from "@/lib/geo";
import {
  bearingFromCompass,
  buildArrowHead,
  buildProjectedPath,
  destinationPoint,
  HEADING_RAY_KM,
  parseMovementText,
} from "@/lib/tc-projection";

describe("parseMovementText", () => {
  // Real PAGASA daily-advisory phrasing, per lib/pagasa-daily fixtures.
  it("parses the standard PAGASA movement line", () => {
    expect(parseMovementText("NORTHWESTWARD AT 20 KM/H")).toEqual({
      bearingDeg: 315,
      speedKph: 20,
    });
  });

  it("prefers the three-word compass over its two-word suffix", () => {
    // "WEST NORTHWESTWARD" must resolve to WNW (292.5°), not NW (315°).
    expect(parseMovementText("WEST NORTHWESTWARD AT 30 KM/H")).toEqual({
      bearingDeg: 292.5,
      speedKph: 30,
    });
  });

  it("handles lowercase, hyphens, and KPH spelling", () => {
    expect(parseMovementText("moving west-southwestward at 15 kph")).toEqual({
      bearingDeg: 247.5,
      speedKph: 15,
    });
  });

  it("returns a direction-only motion when no speed is given", () => {
    expect(parseMovementText("MOVING WESTWARD SLOWLY")).toEqual({
      bearingDeg: 270,
      speedKph: null,
    });
  });

  // A storm that is not going anywhere must not get a projection ray.
  it.each(["ALMOST STATIONARY", "Quasi-stationary", "QUASI STATIONARY"])(
    "returns null for %s",
    (text) => {
      expect(parseMovementText(text)).toBeNull();
    },
  );

  it("returns null for unrecognized or empty text", () => {
    expect(parseMovementText("")).toBeNull();
    expect(parseMovementText(null)).toBeNull();
    expect(parseMovementText("REMNANT LOW")).toBeNull();
  });
});

describe("bearingFromCompass", () => {
  it("maps 16-point codes case-insensitively", () => {
    expect(bearingFromCompass("WNW")).toBe(292.5);
    expect(bearingFromCompass("n")).toBe(0);
    expect(bearingFromCompass("SSE")).toBe(157.5);
  });

  it("returns null for junk", () => {
    expect(bearingFromCompass("NORTHISH")).toBeNull();
    expect(bearingFromCompass(null)).toBeNull();
  });
});

describe("destinationPoint", () => {
  it("moves ~1 degree of latitude per 111 km northward", () => {
    const [lng, lat] = destinationPoint([125, 15], 0, 111);
    expect(lng).toBeCloseTo(125, 3);
    expect(lat).toBeCloseTo(16, 1);
  });

  it("round-trips distance through haversine", () => {
    const start: [number, number] = [130.4, 18.2];
    const end = destinationPoint(start, 292.5, 500);
    expect(haversineKm({ lat: start[1], lon: start[0] }, { lat: end[1], lon: end[0] })).toBeCloseTo(500, 0);
  });
});

describe("buildProjectedPath", () => {
  const START: [number, number] = [135, 16];

  it("emits timed +12/+24/+48h points when speed is known", () => {
    const path = buildProjectedPath(START, { bearingDeg: 292.5, speedKph: 20 });
    expect(path.map((p) => p.hoursAhead)).toEqual([0, 12, 24, 48]);
    const [, p12, , p48] = path;
    expect(
      haversineKm({ lat: START[1], lon: START[0] }, { lat: p12.position[1], lon: p12.position[0] }),
    ).toBeCloseTo(240, 0);
    expect(
      haversineKm({ lat: START[1], lon: START[0] }, { lat: p48.position[1], lon: p48.position[0] }),
    ).toBeCloseTo(960, 0);
  });

  it("emits a single untimed ray when only heading is known", () => {
    const path = buildProjectedPath(START, { bearingDeg: 270, speedKph: null });
    expect(path).toHaveLength(2);
    expect(path[1].hoursAhead).toBeNull();
    expect(
      haversineKm({ lat: START[1], lon: START[0] }, { lat: path[1].position[1], lon: path[1].position[0] }),
    ).toBeCloseTo(HEADING_RAY_KM, 0);
  });

  it("returns [] with no motion — stationary storms draw no ray", () => {
    expect(buildProjectedPath(START, null)).toEqual([]);
  });
});

describe("buildArrowHead", () => {
  it("builds a closed triangle whose apex is the tip", () => {
    const ring = buildArrowHead([120, 15], 315, 700);
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual([120, 15]);
    expect(ring[3]).toEqual(ring[0]);
    // Base corners sit behind the tip relative to travel (bearing 315 → the
    // base must be south-east of the tip).
    expect(ring[1][1]).toBeLessThan(15);
    expect(ring[2][1]).toBeLessThan(15);
  });
});
