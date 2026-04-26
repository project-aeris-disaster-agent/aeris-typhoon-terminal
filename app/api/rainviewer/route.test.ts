/** @jest-environment node */
export {};

const originalFetch = global.fetch;

describe("/api/rainviewer", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the upstream payload unchanged on success", async () => {
    const { GET } = await import("./route");
    const payload = {
      version: "2.0",
      generated: 1713830400,
      host: "https://tilecache.rainviewer.com",
      radar: { past: [{ path: "/v2/radar/1/256/{z}/{x}/{y}/2/1_1.png", time: 1 }] },
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    global.fetch = fetchMock as typeof fetch;

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.rainviewer.com/public/weather-maps.json",
      { next: { revalidate: 300 } },
    );
  });

  it("returns 502 when the upstream API fails", async () => {
    const { GET } = await import("./route");
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    global.fetch = fetchMock as typeof fetch;

    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "RainViewer 503" });
  });
});
