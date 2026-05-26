/** @jest-environment node */
export {};

const originalFetch = global.fetch;

describe("client data services", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("fetchNews returns items and preserves upstream feed warnings", async () => {
    const { fetchNews } = await import("./news");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "1",
            source: "ABS-CBN",
            title: "Typhoon update",
            url: "https://example.com",
            publishedAt: "2026-04-23T00:00:00.000Z",
          },
        ],
        errors: ["cnn: timeout"],
      }),
    }) as typeof fetch;

    await expect(fetchNews()).resolves.toEqual({
      items: [
        expect.objectContaining({
          title: "Typhoon update",
        }),
      ],
      warnings: ["cnn: timeout"],
    });
  });

  it("fetchReports throws instead of silently returning an empty list on failure", async () => {
    const { fetchReports } = await import("./reports-client");
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "reports backend down" }),
    }) as typeof fetch;

    await expect(fetchReports()).rejects.toThrow("reports backend down");
  });

  it("fetchRadarFrames rejects invalid payloads instead of returning empty frames", async () => {
    const { fetchRadarFrames } = await import("./satellite-frames");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ host: "https://tile.example", radar: null }),
    }) as typeof fetch;

    await expect(fetchRadarFrames()).rejects.toThrow(
      "RainViewer returned an invalid payload.",
    );
  });

  it("fetchActiveTyphoons returns empty storms with warning when upstream is empty+_error", async () => {
    const { fetchActiveTyphoons } = await import("./typhoon-tracks");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storms: [], _error: "gdacs unavailable" }),
    }) as typeof fetch;

    await expect(fetchActiveTyphoons()).resolves.toEqual({
      storms: [],
      warning: "gdacs unavailable",
    });
  });

  it("fetchActiveTyphoons treats RSS-fallback _warning as non-fatal when storms are present", async () => {
    const { fetchActiveTyphoons } = await import("./typhoon-tracks");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        storms: [
          {
            id: "1001270",
            name: "SINLAKU-26",
            localName: null,
            category: "Super Typhoon",
            position: [156.1, 28.7],
            windKph: 287,
            pressureHpa: 0,
            heading: null,
            landfallEta: null,
            bestTrack: [{ position: [156.1, 28.7] }],
            forecast: [],
          },
        ],
        _warning: "Primary GDACS feed degraded (GDACS 403); serving RSS fallback.",
      }),
    }) as typeof fetch;

    await expect(fetchActiveTyphoons()).resolves.toEqual({
      storms: expect.arrayContaining([
        expect.objectContaining({ id: "1001270", name: "SINLAKU-26" }),
      ]),
      warning: expect.stringContaining("RSS fallback"),
    });
  });

  it("fetchAlerts returns TC and hazard rows from /api/alerts", async () => {
    const { fetchAlerts } = await import("./alerts");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        alerts: [
          {
            id: "tc-1001270",
            source: "GDACS",
            severity: "warning",
            title: "SINLAKU-26 — Tropical storm",
            summary: "85 km/h · Active in PAR · GDACS track",
            issuedAt: null,
          },
          {
            id: "gdacs-1",
            source: "GDACS",
            severity: "warning",
            title: "Flood near Mindanao",
            summary:
              "Heavy rainfall expected across Mindanao with widespread impacts in low-lying areas.",
            issuedAt: "2026-04-23T00:00:00.000Z",
          },
        ],
        error: null,
      }),
    }) as typeof fetch;

    const result = await fetchAlerts();
    expect(result.alerts).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(result.fetchFailed).toBe(false);
  });

  it("fetchAlerts reports failure when /api/alerts returns an error", async () => {
    const { fetchAlerts } = await import("./alerts");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ alerts: [], error: "GDACS RSS 403" }),
    }) as typeof fetch;

    const result = await fetchAlerts();
    expect(result.alerts).toEqual([]);
    expect(result.fetchFailed).toBe(true);
    expect(result.warnings).toEqual(["GDACS: GDACS RSS 403"]);
  });

  it("fetchAlerts succeeds with empty list when feeds work but PAR has no events", async () => {
    const { fetchAlerts } = await import("./alerts");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ alerts: [], error: null }),
    }) as typeof fetch;

    const result = await fetchAlerts();
    expect(result.alerts).toEqual([]);
    expect(result.fetchFailed).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});
