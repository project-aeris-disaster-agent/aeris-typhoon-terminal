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

  it("replays the last good wind grid as degraded when the upstream later fails", async () => {
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

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => blocks }) as typeof fetch;
    const fresh = await GET();
    const freshBody = await fresh.json();
    expect(fresh.status).toBe(200);
    expect(freshBody.degraded).toBeUndefined();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ hourly: {} }],
    }) as typeof fetch;
    const degraded = await GET();
    const degradedBody = await degraded.json();

    expect(degraded.status).toBe(200);
    expect(degraded.headers.get("cache-control")).toBe(
      "public, s-maxage=120, stale-while-revalidate=720",
    );
    expect(degradedBody.degraded).toBe(true);
    expect(degradedBody.u).toEqual(freshBody.u);
    expect(degradedBody.v).toEqual(freshBody.v);
    expect(degradedBody.p).toEqual(freshBody.p);
    expect(degradedBody.generatedAt).toBe(freshBody.generatedAt);
  });

  it("returns 502 on upstream failure when no prior good wind grid is cached", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockRejectedValue(new Error("Open-Meteo down")) as typeof fetch;

    const res = await GET();
    expect(res.status).toBe(502);
  });
});
