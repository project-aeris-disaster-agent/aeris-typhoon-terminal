/** @jest-environment node */

import {
  jpCourseToCompass,
  parseJmaStorm,
  typhoonNumberFromText,
} from "@/lib/jma-typhoon";
import tc2618Forecast from "@/test/fixtures/jma-TC2618-forecast.json";
import tc2618Spec from "@/test/fixtures/jma-TC2618-specifications.json";
import tc2617Forecast from "@/test/fixtures/jma-TC2617-forecast.json";
import tc2617Spec from "@/test/fixtures/jma-TC2617-specifications.json";

// Fixtures are the live bosai payloads captured 2026-08-11 — the same PEILOU
// the dashboard was showing from the PAGASA advisory, so cross-source facts
// (typhoon number, rough position) can be checked against each other.

describe("parseJmaStorm — TC2618 (PEILOU)", () => {
  const storm = parseJmaStorm("TC2618", tc2618Forecast, tc2618Spec)!;

  it("parses identity and links to the PAGASA storm number", () => {
    expect(storm).not.toBeNull();
    expect(storm.name).toBe("Peilou");
    expect(storm.typhoonNumber).toBe("2616");
    expect(storm.category).toBe("Tropical Storm");
    // PAGASA prints "TROPICAL STORM PEILOU (2616)" — the join key must match.
    expect(typhoonNumberFromText("TROPICAL STORM PEILOU (2616)")).toBe("2616");
  });

  it("flips JMA [lat, lng] to our [lng, lat]", () => {
    // JMA analysis center is [22.7, 153.2] (lat, lng): east of the PH, not in
    // the Gulf of Thailand. A missed flip puts every storm ~30° off.
    expect(storm.position).toEqual([153.2, 22.7]);
  });

  it("converts knots to km/h and reads pressure/heading/speed", () => {
    expect(storm.windKph).toBe(83); // 45 kt
    expect(storm.gustKph).toBe(120); // 65 kt
    expect(storm.pressureHpa).toBe(992);
    expect(storm.heading).toBe("NE"); // 北東
    expect(storm.speedKph).toBe(30);
  });

  it("builds the observed track ending at the analysis position", () => {
    // preTyphoon and typhoon phases share their junction point — deduped.
    expect(storm.track.length).toBeGreaterThan(10);
    const junctions = storm.track.filter(
      ([lng, lat]) => lng === 142.7 && lat === 21.2,
    );
    expect(junctions).toHaveLength(1);
    expect(storm.track[storm.track.length - 1]).toEqual(storm.position);
  });

  it("parses forecast points with hours, probability radii, and winds", () => {
    expect(storm.forecast.map((p) => p.hoursAhead)).toEqual([12, 24, 45]);
    const p12 = storm.forecast[0];
    expect(p12.position).toEqual([156.2, 24.7]);
    // probabilityCircle.radius is meters (83340) — must land as km.
    expect(p12.probabilityRadiusKm).toBe(83);
    expect(p12.windKph).toBe(83); // 45 kt at +12h
    expect(p12.validTimeUtc).toBe("2026-08-11T03:00:00Z");
  });

  it("takes the largest gale sector as the gale radius", () => {
    // Sectors: 南 390 km, 北 220 km — asymmetric, max wins.
    expect(storm.galeRadiusKm).toBe(390);
  });
});

describe("parseJmaStorm — TC2617 (second storm, near Japan)", () => {
  it("parses independently of PEILOU", () => {
    const storm = parseJmaStorm("TC2617", tc2617Forecast, tc2617Spec)!;
    expect(storm).not.toBeNull();
    expect(storm.typhoonNumber).toBe("2615");
    expect(storm.position).toEqual([145.7, 36.7]);
    expect(storm.heading).toBe("NW"); // 北西
    expect(storm.galeRadiusKm).toBe(500);
  });
});

describe("parseJmaStorm — malformed payloads", () => {
  it("returns null rather than a partial storm", () => {
    expect(parseJmaStorm("TCX", [], [])).toBeNull();
    expect(parseJmaStorm("TCX", null, null)).toBeNull();
    expect(parseJmaStorm("TCX", [{ part: "title" }], [{ part: "title" }])).toBeNull();
  });
});

describe("jpCourseToCompass", () => {
  it.each([
    ["北", "N"],
    ["北東", "NE"],
    ["西北西", "WNW"],
    ["南南西", "SSW"],
  ])("%s → %s", (jp, en) => {
    expect(jpCourseToCompass(jp)).toBe(en);
  });

  it("returns null for unknown text", () => {
    expect(jpCourseToCompass("ほぼ停滞")).toBeNull();
    expect(jpCourseToCompass(null)).toBeNull();
  });
});

describe("typhoonNumberFromText", () => {
  it("extracts the parenthesised storm number", () => {
    expect(typhoonNumberFromText("TYPHOON GORING (2617)")).toBe("2617");
    expect(typhoonNumberFromText("no number here")).toBeNull();
    expect(typhoonNumberFromText(null)).toBeNull();
  });
});
