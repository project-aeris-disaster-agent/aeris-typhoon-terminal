/** @jest-environment node */
export {};

import { isNavSlop, isSubstantiveAlert } from "./alert-quality";

describe("alert-quality", () => {
  it("rejects nav menu slop", () => {
    expect(
      isNavSlop("Tropical Cyclone Warning for Agriculture Tropical Cyclone Warning for Agriculture -->"),
    ).toBe(true);
  });

  it("accepts GDACS hazard rows with real descriptions", () => {
    expect(
      isSubstantiveAlert({
        id: "gdacs-1",
        source: "GDACS",
        title: "Green earthquake (Magnitude 5.7M)",
        summary:
          "On 5/19/2026, an earthquake occurred in Vanuatu potentially affecting 100 thousand in MMI IV.",
      }),
    ).toBe(true);
  });

  it("accepts TC situation rows with wind data", () => {
    expect(
      isSubstantiveAlert({
        id: "tc-1",
        source: "GDACS",
        title: "SINLAKU-26 — TS",
        summary: "85 km/h · 992 hPa · Moving NW",
      }),
    ).toBe(true);
  });
});
