/** @jest-environment node */
export {};

const originalFetch = global.fetch;

describe("/api/pagasa", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("extracts, classifies, and deduplicates tropical cyclone advisories", async () => {
    const { GET } = await import("./route");
    const html = `
      <a href="/tropical-cyclone/severe-weather-bulletin-1">Tropical Cyclone Bulletin Signal #1 for Luzon Apr 23, 2026 08:00 AM</a>
      <a href="/tropical-cyclone/severe-weather-bulletin-1">Tropical Cyclone Bulletin Signal #1 for Luzon Apr 23, 2026 08:00 AM</a>
      <a href="https://www.pagasa.dost.gov.ph/warning">Super Typhoon Warning Signal #4</a>
      <a href="/news/other">Seasonal rainfall outlook</a>
    `;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    }) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alerts).toHaveLength(2);
    expect(body.alerts).toEqual([
      expect.objectContaining({
        source: "PAGASA",
        severity: "watch",
        title: "Tropical Cyclone Bulletin Signal #1 for Luzon Apr 23, 2026 08:00 AM",
        url: "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin-1",
        issuedAt: expect.any(String),
      }),
      expect.objectContaining({
        source: "PAGASA",
        severity: "emergency",
        title: "Super Typhoon Warning Signal #4",
        url: "https://www.pagasa.dost.gov.ph/warning",
        issuedAt: null,
      }),
    ]);
  });

  it("returns a 502 error payload with empty alerts when PAGASA is unavailable", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as typeof fetch;

    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "PAGASA 503",
      alerts: [],
    });
  });
});
