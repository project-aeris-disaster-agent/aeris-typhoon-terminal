/** @jest-environment node */
export {};

const originalFetch = global.fetch;

describe("/api/wind-field", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns a wind grid when Open-Meteo returns one block per grid point", async () => {
    const { GET } = await import("./route");
    const expected = 16 * 10;
    const blocks = Array.from({ length: expected }, (_, i) => ({
      latitude: 10 + i * 0.01,
      longitude: 120 + i * 0.01,
      hourly: {
        wind_speed_10m: [5 + (i % 3)],
        wind_direction_10m: [90 + i],
        pressure_msl: [1008 - (i % 5) * 0.1],
      },
    }));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => blocks,
    }) as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.width).toBe(16);
    expect(data.height).toBe(10);
    expect(data.u).toHaveLength(expected);
    expect(data.v).toHaveLength(expected);
    expect(data.p).toHaveLength(expected);
    expect(typeof data.u[0]).toBe("number");
  });

  it("returns 502 when upstream returns wrong shape", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ hourly: {} }],
    }) as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(502);
  });
});
