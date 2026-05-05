/** @jest-environment node */
export {};

const originalFetch = global.fetch;

describe("/api/pagasa-water-levels", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("normalizes upstream station payloads into map-friendly rows", async () => {
    const { GET } = await import("./route");
    global.fetch = jest
      .fn()
      // map.do HTML request
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "<h4>Time : 2026-05-06 04:10</h4>",
      })
      // map_list.do JSON request
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            obscd: "11102203",
            agctype: "001",
            obsnm: "Burgos",
            lon: 121.1445333,
            lat: 14.7219333,
            timestr: "2026-05-06 04:10",
            wl: "28.00",
            alertwl: "27.40",
            alarmwl: "27.90",
            criticalwl: "28.40",
          },
          {
            obscd: "11105201",
            agctype: "002",
            obsnm: "Angono",
            lon: 121.1423667,
            lat: 14.5268306,
            wl: "10.90(*)",
            alertwl: null,
            alarmwl: null,
            criticalwl: null,
          },
        ],
      }) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updatedAt).toBe("2026-05-06 04:10");
    expect(body.stations).toEqual([
      expect.objectContaining({
        id: "11102203",
        name: "Burgos",
        stationType: "pagasa",
        current: 28,
        alert: 27.4,
        alarm: 27.9,
        critical: 28.4,
        level: "alarm",
      }),
      expect.objectContaining({
        id: "11105201",
        name: "Angono",
        stationType: "mmda",
        current: 10.9,
        level: "normal",
      }),
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("map_list.do?ymdhm=202605060410"),
      expect.any(Object),
    );
  });

  it("returns a 502 payload when upstream request fails", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as typeof fetch;

    const response = await GET();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "PAGASA water levels 503",
      updatedAt: null,
      stations: [],
    });
  });
});
