import type { NationalWeatherSnapshot } from "@/services/weather-snapshot";

jest.mock("@/services/weather-snapshot", () => ({
  buildNationalWeatherSnapshot: jest.fn(),
}));
jest.mock("@/lib/pagasa-daily", () => ({
  fetchPagasaDailyWeather: jest.fn(),
}));
jest.mock("@/lib/pagasa-bulletins", () => ({
  fetchPagasaBulletins: jest.fn(),
}));

import { buildNationalWeatherSnapshot } from "@/services/weather-snapshot";
import { fetchPagasaDailyWeather } from "@/lib/pagasa-daily";
import { fetchPagasaBulletins } from "@/lib/pagasa-bulletins";
import { buildAgentLiveContext } from "@/lib/agent-context";

const NOW_ISO = "2026-05-27T14:00:00.000Z";

function fakeSnapshot(
  overrides: Partial<NationalWeatherSnapshot> = {},
): NationalWeatherSnapshot {
  return {
    generatedAt: NOW_ISO,
    scope: { type: "national", key: "PH" },
    alerts: [],
    alertSignature: "sig",
    typhoonAlerts: [
      {
        id: "tc-jangmi",
        source: "GDACS",
        severity: "warning",
        title: "TROPICAL STORM JANGMI",
        summary: "1,260 KM EAST OF EASTERN VISAYAS (10.0°N, 137.2°E)",
        issuedAt: NOW_ISO,
      },
    ],
    nationalForecast: {
      maxWindKph: 25,
      totalRainMm: 12,
      minPressureHpa: 1009,
      daily: [],
    },
    nationalForecastAlert: { level: 1, score: 20, label: "Watch", tone: "warn" },
    regionalForecasts: [],
    worstRegionalAlert: { level: 2, score: 55, label: "Warning", tone: "warn" },
    waterLevels: {
      updatedAt: NOW_ISO,
      elevated: [
        { name: "Marikina River", level: "alarm", current: 18.5 } as never,
      ],
      stationCount: 30,
    },
    verdict: {
      tone: "warn",
      label: "Elevated risk",
      reasons: ["TC outside PAR", "Marikina at alarm"],
    },
    severityScore: 55,
    sourcesFreshness: {
      gdacs: NOW_ISO,
      openMeteo: NOW_ISO,
      waterLevels: NOW_ISO,
    },
    briefFacts: ["Heavy rains in Mindanao", "Marikina River at alarm"],
    ...overrides,
  };
}

describe("buildAgentLiveContext", () => {
  beforeEach(() => {
    (buildNationalWeatherSnapshot as jest.Mock).mockReset();
    (fetchPagasaDailyWeather as jest.Mock).mockReset();
    (fetchPagasaBulletins as jest.Mock).mockReset();
    (fetchPagasaBulletins as jest.Mock).mockResolvedValue(null);
  });

  it("composes national context, typhoon coords, and PAGASA daily", async () => {
    (buildNationalWeatherSnapshot as jest.Mock).mockResolvedValue(
      fakeSnapshot(),
    );
    (fetchPagasaDailyWeather as jest.Mock).mockResolvedValue({
      source: "pagasa-daily",
      url: "https://www.pagasa.dost.gov.ph/weather",
      fetchedAt: NOW_ISO,
      issuedAt: "4:00 PM, 27 May 2026",
      synopsis: "Southwesterly Windflow",
      tcOutsidePar: null,
      regionalConditions: [],
    });
    (fetchPagasaBulletins as jest.Mock).mockResolvedValue({
      source: "pagasa-bulletins",
      via: "pagasa-parser",
      fetchedAt: NOW_ISO,
      hasActive: true,
      bulletins: [
        {
          name: "Ester",
          number: 6,
          final: false,
          file: "TCB#6_ester.pdf",
          pdfUrl: "https://pubfiles.pagasa.dost.gov.ph/.../TCB%236_ester.pdf",
        },
      ],
    });

    const ctx = await buildAgentLiveContext(null);

    expect(ctx.regionLock).toBe("Philippines");
    expect(ctx.national.verdictLabel).toBe("Elevated risk");
    expect(ctx.national.severityScore).toBe(55);
    expect(ctx.national.typhoonAlerts).toHaveLength(1);
    expect(ctx.national.typhoonAlerts[0].coords).toEqual({ lat: 10, lon: 137.2 });
    expect(ctx.national.elevatedRivers[0].name).toBe("Marikina River");
    expect(ctx.pagasaDaily?.issuedAt).toBe("4:00 PM, 27 May 2026");
    expect(ctx.pagasaBulletins?.hasActive).toBe(true);
    expect(ctx.pagasaBulletins?.bulletins[0].name).toBe("Ester");
    expect(ctx.freshness.pagasaBulletins).toBe(NOW_ISO);
    expect(ctx.freshness.pagasaBulletinsStale).toBe(false);
    expect(ctx.freshness.pagasaBulletinsWarning).toBeNull();
    expect(ctx.selectedLocation).toBeNull();
  });

  it("surfaces stale bulletin metadata in freshness", async () => {
    (buildNationalWeatherSnapshot as jest.Mock).mockResolvedValue(
      fakeSnapshot(),
    );
    (fetchPagasaDailyWeather as jest.Mock).mockResolvedValue(null);
    (fetchPagasaBulletins as jest.Mock).mockResolvedValue({
      source: "pagasa-bulletins",
      via: "pagasa-parser",
      fetchedAt: NOW_ISO,
      indexAgeSeconds: 1200,
      stale: true,
      warning: "Live bulletin index unavailable; showing most recent successful snapshot.",
      hasActive: true,
      bulletins: [],
    });

    const ctx = await buildAgentLiveContext(null);

    expect(ctx.freshness.pagasaBulletinsIndexAgeSeconds).toBe(1200);
    expect(ctx.freshness.pagasaBulletinsStale).toBe(true);
    expect(ctx.freshness.pagasaBulletinsWarning).toContain("unavailable");
  });

  it("computes nearest region and nearest typhoon for a selected location", async () => {
    (buildNationalWeatherSnapshot as jest.Mock).mockResolvedValue(
      fakeSnapshot(),
    );
    (fetchPagasaDailyWeather as jest.Mock).mockResolvedValue(null);

    // Tacloban-ish coords in Eastern Visayas (R8 center is 125.0, 11.5)
    const ctx = await buildAgentLiveContext({
      name: "Tacloban",
      lat: 11.24,
      lon: 125.0,
    });

    expect(ctx.selectedLocation).not.toBeNull();
    expect(ctx.selectedLocation!.name).toBe("Tacloban");
    expect(ctx.selectedLocation!.nearestRegion?.code).toBe("R8");
    expect(ctx.selectedLocation!.nearestTyphoon?.name).toContain("JANGMI");
    expect(ctx.selectedLocation!.nearestTyphoon!.km).toBeGreaterThan(0);
  });

  it("tolerates pagasa-daily failure", async () => {
    (buildNationalWeatherSnapshot as jest.Mock).mockResolvedValue(
      fakeSnapshot(),
    );
    (fetchPagasaDailyWeather as jest.Mock).mockRejectedValue(new Error("boom"));

    const ctx = await buildAgentLiveContext(null);
    expect(ctx.pagasaDaily).toBeNull();
    expect(ctx.freshness.pagasaDaily).toBeNull();
  });
});
