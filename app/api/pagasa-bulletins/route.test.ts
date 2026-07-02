/** @jest-environment node */
export {};

// This suite covers the route's bulletin plumbing (reduction + refresh bypass).
// The storm-watch staleness filter it now applies is disabled here so fetch
// accounting stays about the upstream call; the filter has its own unit tests
// in lib/pagasa-bulletin-staleness.test.ts.
jest.mock("@/lib/storm-watch/state", () => ({
  stormWatchStateEnabled: () => false,
  listStormWatchCycles: async () => [],
}));

const originalFetch = global.fetch;

describe("/api/pagasa-bulletins", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the reduced active-bulletin index from upstream", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        error: false,
        age: 45,
        bulletins: [
          {
            name: "ester",
            count: 6,
            final: false,
            file: "TCB#6_ester.pdf",
            link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%236_ester.pdf",
          },
        ],
      }),
    }) as typeof fetch;

    const res = await GET(new Request("http://localhost/api/pagasa-bulletins"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    expect(body.pagasaBulletins.hasActive).toBe(true);
    expect(body.pagasaBulletins.indexAgeSeconds).toBe(45);
    expect(body.pagasaBulletins.bulletins[0].name).toBe("Ester");
    expect(body.pagasaBulletins.bulletins[0].number).toBe(6);
  });

  it("returns ok:false payload when upstream fails and no stale snapshot exists", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as typeof fetch;

    const res = await GET(new Request("http://localhost/api/pagasa-bulletins"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(false);
    expect(body.pagasaBulletins).toBeNull();
  });

  it("honors refresh=1 by bypassing the in-process cache", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          error: false,
          age: 0,
          bulletins: [
            {
              name: "ester",
              count: 6,
              final: false,
              file: "TCB#6_ester.pdf",
              link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%236_ester.pdf",
            },
          ],
        }),
      });
    global.fetch = fetchMock as typeof fetch;

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/pagasa-bulletins"));
    await GET(
      new Request("http://localhost/api/pagasa-bulletins?refresh=1"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
