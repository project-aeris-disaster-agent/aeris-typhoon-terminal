/** @jest-environment node */
export {};

import { NextRequest } from "next/server";

const originalFetch = global.fetch;

describe("/api/open-meteo", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("rejects missing or out-of-bounds coordinates", async () => {
    const { GET } = await import("./route");

    const missing = await GET(new NextRequest("http://localhost/api/open-meteo"));
    const outside = await GET(
      new NextRequest("http://localhost/api/open-meteo?lat=40&lng=120"),
    );

    await expect(missing.json()).resolves.toEqual({ error: "lat and lng required" });
    await expect(outside.json()).resolves.toEqual({
      error: "coordinate outside Philippines",
    });
    expect(missing.status).toBe(400);
    expect(outside.status).toBe(400);
  });

  it("returns rounded daily values and summary metrics from the upstream payload", async () => {
    const { GET } = await import("./route");
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-04-23", "2026-04-24"],
          temperature_2m_min: [24.2, 23.6],
          temperature_2m_max: [31.8, 32.4],
          precipitation_sum: [12.34, 0.04],
          wind_speed_10m_max: [44.6, 51.2],
          pressure_msl_min: [1002.2, 998.7],
        },
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/open-meteo?lat=14.5995&lng=120.9842"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      maxWindKph: 51,
      totalRainMm: 12.3,
      minPressureHpa: 999,
      daily: [
        {
          date: "2026-04-23",
          tempMin: 24,
          tempMax: 32,
          rainMm: 12.3,
          windKph: 45,
          pressureHpa: 1002,
        },
        {
          date: "2026-04-24",
          tempMin: 24,
          tempMax: 32,
          rainMm: 0,
          windKph: 51,
          pressureHpa: 999,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toContain("latitude=14.5995");
    expect(String(calledUrl)).toContain("longitude=120.9842");
    expect(options).toEqual({ next: { revalidate: 1800 } });
  });

  it("returns 502 on upstream failure and opens the circuit after repeated failures", async () => {
    const { GET } = await import("./route");
    const fetchMock = jest.fn().mockRejectedValue(new Error("upstream down"));
    global.fetch = fetchMock as typeof fetch;

    const request = new NextRequest(
      "http://localhost/api/open-meteo?lat=14.5995&lng=120.9842",
    );

    const first = await GET(request);
    const second = await GET(request);
    const third = await GET(request);
    const fourth = await GET(request);

    await expect(first.json()).resolves.toEqual({ error: "upstream down" });
    await expect(second.json()).resolves.toEqual({ error: "upstream down" });
    await expect(third.json()).resolves.toEqual({ error: "upstream down" });
    await expect(fourth.json()).resolves.toEqual({
      error: "Circuit open for open-meteo",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fourth.status).toBe(502);
  });

  it("replays the last good forecast as degraded when the upstream later fails", async () => {
    const { GET } = await import("./route");
    const upstream = {
      daily: {
        time: ["2026-04-23", "2026-04-24"],
        temperature_2m_min: [24.2, 23.6],
        temperature_2m_max: [31.8, 32.4],
        precipitation_sum: [12.34, 0.04],
        wind_speed_10m_max: [44.6, 51.2],
        pressure_msl_min: [1002.2, 998.7],
      },
    };
    const request = new NextRequest(
      "http://localhost/api/open-meteo?lat=14.5995&lng=120.9842",
    );

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => upstream }) as typeof fetch;
    const fresh = await GET(request);
    const freshBody = await fresh.json();
    expect(fresh.status).toBe(200);
    expect(freshBody.degraded).toBeUndefined();

    global.fetch = jest.fn().mockRejectedValue(new Error("upstream down")) as typeof fetch;
    const degraded = await GET(request);
    const degradedBody = await degraded.json();

    expect(degraded.status).toBe(200);
    expect(degraded.headers.get("cache-control")).toBe(
      "public, s-maxage=120, stale-while-revalidate=720",
    );
    expect(degradedBody.degraded).toBe(true);
    expect(degradedBody.maxWindKph).toBe(freshBody.maxWindKph);
    expect(degradedBody.daily).toEqual(freshBody.daily);
  });

  it("returns 502 on upstream failure when no prior good forecast is cached", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockRejectedValue(new Error("upstream down")) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/open-meteo?lat=14.5995&lng=120.9842"),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "upstream down" });
  });

  it("returns 502 when Open-Meteo responds with mismatched daily arrays", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-04-23", "2026-04-24"],
          temperature_2m_min: [24.2],
          temperature_2m_max: [31.8, 32.4],
          precipitation_sum: [12.34, 0.04],
          wind_speed_10m_max: [44.6, 51.2],
          pressure_msl_min: [1002.2, 998.7],
        },
      }),
    }) as typeof fetch;

    const response = await GET(
      new NextRequest("http://localhost/api/open-meteo?lat=14.5995&lng=120.9842"),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Open-Meteo returned an invalid daily forecast payload.",
    });
  });
});
