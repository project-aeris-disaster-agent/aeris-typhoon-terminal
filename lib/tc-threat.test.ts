import {
  assessOutsideParThreat,
  bearingFromCompass,
  initialBearing,
  motionBearing,
  parDistanceKm,
} from "./tc-threat";

describe("parDistanceKm", () => {
  it("is zero inside the PAR box", () => {
    expect(parDistanceKm(125, 14)).toBe(0);
  });

  it("grows with distance east of PAR", () => {
    const near = parDistanceKm(140, 12); // just east of 135E
    const far = parDistanceKm(170, 12);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it("is very large for Eastern Pacific systems", () => {
    expect(parDistanceKm(-136.3, 11.3)).toBeGreaterThan(8000);
  });
});

describe("bearingFromCompass", () => {
  it("maps compass tokens to degrees", () => {
    expect(bearingFromCompass("N")).toBe(0);
    expect(bearingFromCompass("W")).toBe(270);
    expect(bearingFromCompass("nnw")).toBe(337.5);
  });

  it("returns null for unknown or missing values", () => {
    expect(bearingFromCompass(null)).toBeNull();
    expect(bearingFromCompass("toward land")).toBeNull();
  });
});

describe("motionBearing", () => {
  it("prefers displacement between the last two track points", () => {
    // Moving due west.
    expect(motionBearing([[160, 12], [158, 12]], "N")).toBeCloseTo(270, 0);
  });

  it("falls back to the compass heading when track has one point", () => {
    expect(motionBearing([[160, 12]], "W")).toBe(270);
  });
});

describe("assessOutsideParThreat", () => {
  it("is relevant when close to PAR regardless of motion", () => {
    const t = assessOutsideParThreat({
      position: [140, 12], // ~550 km east of PAR
      track: [[138, 12], [140, 12]], // moving away (east)
      heading: "E",
    });
    expect(t.relevant).toBe(true);
    expect(t.approachingPar).toBe(false);
    expect(t.distanceToParKm).toBeLessThan(1000);
  });

  it("is relevant when far but tracking toward PAR", () => {
    const t = assessOutsideParThreat({
      position: [160, 12], // ~2700 km east of PAR
      track: [[162, 12], [160, 12]], // moving west, toward PAR
      heading: "W",
    });
    expect(t.approachingPar).toBe(true);
    expect(t.relevant).toBe(true);
  });

  it("is not relevant when far and moving away", () => {
    const t = assessOutsideParThreat({
      position: [160, 12],
      track: [[158, 12], [160, 12]], // moving east, away from PAR
      heading: "E",
    });
    expect(t.approachingPar).toBe(false);
    expect(t.relevant).toBe(false);
  });

  it("uses heading fallback when only one track point is available", () => {
    const approaching = assessOutsideParThreat({
      position: [160, 12],
      track: [[160, 12]],
      heading: "W",
    });
    expect(approaching.approachingPar).toBe(true);

    const drifting = assessOutsideParThreat({
      position: [160, 12],
      track: [[160, 12]],
      heading: "E",
    });
    expect(drifting.approachingPar).toBe(false);
    expect(drifting.relevant).toBe(false);
  });
});

describe("initialBearing", () => {
  it("computes a roughly westward bearing", () => {
    // Great-circle bearing curves slightly poleward over a wide span.
    const b = initialBearing([160, 12], [135, 12]);
    expect(b).toBeGreaterThan(265);
    expect(b).toBeLessThan(280);
  });
});
