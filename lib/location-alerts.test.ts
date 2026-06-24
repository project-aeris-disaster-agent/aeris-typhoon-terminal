/** @jest-environment node */
export {};

import type { Alert } from "@/services/alerts";
import type { Typhoon } from "@/services/typhoon-tracks";
import {
  filterAlertsForLocation,
  HAZARD_LOCATION_MAX_KM,
  TC_LOCATION_MAX_KM,
  worstLocationAlertSeverity,
} from "./location-alerts";

function tcAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "tc-1000",
    source: "GDACS",
    severity: "emergency",
    title: "MEKKHALA-26 — Typhoon",
    summary: "231 km/h · Active in PAR",
    issuedAt: null,
    ...overrides,
  };
}

function hazardAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "gdacs-h1",
    source: "GDACS",
    severity: "warning",
    title: "Flood in Bicol",
    summary: "Heavy rainfall expected across Bicol with widespread impacts.",
    issuedAt: null,
    ...overrides,
  };
}

function storm(overrides: Partial<Typhoon> = {}): Typhoon {
  return {
    id: "storm-1",
    name: "MEKKHALA",
    category: "Typhoon",
    position: [125.0, 14.5],
    windKph: 231,
    pressureHpa: 950,
    bestTrack: [
      {
        position: [125.0, 14.5],
        radiusKm: { kt60: 120, kt30: 80, kt15: 200 },
      },
    ],
    forecast: [
      { position: [125.0, 14.5] },
      { position: [124.5, 15.0] },
      { position: [124.0, 15.5] },
    ],
    ...overrides,
  };
}

describe("filterAlertsForLocation", () => {
  it("includes TC alert when the pin is inside the forecast cone", () => {
    const result = filterAlertsForLocation(
      14.8,
      124.8,
      [tcAlert()],
      [storm()],
    );

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].relevanceReason).toBe("Inside forecast cone");
    expect(result.reasons["tc-1000"]).toBe("Inside forecast cone");
  });

  it("includes TC alert when the pin is inside a wind-radius ring", () => {
    const result = filterAlertsForLocation(
      14.5,
      125.0,
      [tcAlert()],
      [
        storm({
          forecast: [{ position: [130.0, 18.0] }],
          bestTrack: [
            {
              position: [130.0, 18.0],
              radiusKm: { kt15: 250 },
            },
          ],
        }),
      ],
    );

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].relevanceReason).toBe("Within 34 kt wind radius");
  });

  it("includes TC alert by center distance when cone/radii do not match", () => {
    const farStorm = storm({
      position: [126.0, 16.0],
      forecast: [{ position: [126.0, 16.0] }],
      bestTrack: [{ position: [126.0, 16.0], radiusKm: {} }],
    });

    const result = filterAlertsForLocation(
      16.0,
      126.0,
      [tcAlert()],
      [farStorm],
    );

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].relevanceReason).toMatch(/km from center/);
    expect(result.alerts[0].distanceKm).toBeLessThanOrEqual(TC_LOCATION_MAX_KM);
  });

  it("excludes TC alert when the pin is far from the system", () => {
    const result = filterAlertsForLocation(
      7.0,
      125.0,
      [tcAlert()],
      [
        storm({
          position: [137.0, 9.0],
          forecast: [{ position: [137.0, 9.0] }],
          bestTrack: [{ position: [137.0, 9.0], radiusKm: {} }],
        }),
      ],
    );

    expect(result.alerts).toHaveLength(0);
  });

  it("matches hazard alerts to the nearest admin region mentioned in text", () => {
    const result = filterAlertsForLocation(
      13.5,
      123.4,
      [hazardAlert()],
      [],
    );

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].relevanceReason).toBe("Mentions Bicol");
  });

  it("includes hazard alerts with coordinates within the distance threshold", () => {
    const result = filterAlertsForLocation(
      14.6,
      120.98,
      [
        hazardAlert({
          title: "Earthquake near Manila",
          summary: "Magnitude 5.5 earthquake reported.",
          lat: 14.65,
          lon: 121.0,
        }),
      ],
      [],
    );

    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].distanceKm).toBeLessThanOrEqual(
      HAZARD_LOCATION_MAX_KM,
    );
  });

  it("sorts by severity then distance", () => {
    const result = filterAlertsForLocation(
      14.6,
      121.0,
      [
        hazardAlert({
          id: "gdacs-info",
          severity: "info",
          title: "Green earthquake in Metro Manila",
          summary: "Minor shaking reported across Metro Manila.",
        }),
        tcAlert({ id: "tc-2000", severity: "warning", title: "ALERTA-26 — Storm" }),
      ],
      [
        storm({
          id: "storm-2",
          name: "ALERTA",
          position: [121.0, 14.6],
          forecast: [{ position: [121.0, 14.6] }],
          bestTrack: [{ position: [121.0, 14.6], radiusKm: {} }],
        }),
      ],
    );

    expect(result.alerts[0].severity).toBe("warning");
    expect(result.alerts[1].severity).toBe("info");
  });
});

describe("worstLocationAlertSeverity", () => {
  it("returns the highest severity among location alerts", () => {
    const alerts = filterAlertsForLocation(
      14.8,
      124.8,
      [
        tcAlert({ severity: "watch" }),
        hazardAlert({ severity: "emergency", title: "Flood in Bicol" }),
      ],
      [storm()],
    ).alerts;

    expect(worstLocationAlertSeverity(alerts)).toBe("emergency");
  });
});
