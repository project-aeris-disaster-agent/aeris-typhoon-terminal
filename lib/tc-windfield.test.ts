/** @jest-environment node */

import { estimateWindField } from "@/lib/tc-windfield";

describe("estimateWindField", () => {
  // A tropical depression has no gale-force field by definition — drawing a
  // circle for one would be invention, not estimation.
  it("returns null below tropical-storm intensity", () => {
    expect(estimateWindField(55)).toBeNull();
    expect(estimateWindField(61)).toBeNull();
  });

  it("returns null for missing or junk wind values", () => {
    expect(estimateWindField(null)).toBeNull();
    expect(estimateWindField(undefined)).toBeNull();
    expect(estimateWindField(0)).toBeNull();
    expect(estimateWindField(NaN)).toBeNull();
  });

  // PAGASA category boundaries (km/h): TS 62–88, STS 89–117, TY 118–184,
  // STY ≥185. Each category maps to one climatological disc size, and the
  // storm-force inner disc only exists from STS up.
  it.each([
    [62, 150, null],
    [75, 150, null], // PEILOU as observed
    [88, 150, null],
    [89, 200, 60],
    [117, 200, 60],
    [118, 260, 90],
    [184, 260, 90],
    [185, 320, 110],
    [240, 320, 110],
  ])("%d km/h → gale %d km, storm %p km", (wind, galeKm, stormKm) => {
    expect(estimateWindField(wind)).toEqual({ galeKm, stormKm });
  });
});
