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

const ACTIVE_SWB_HTML =
  "<html><body><h3>Tropical Cyclone Bulletin</h3></body></html>";

function mockUpstream(indexBody: unknown) {
  return jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("severe-weather-bulletin")) {
      return { ok: true, text: async () => ACTIVE_SWB_HTML };
    }
    return {
      ok: true,
      json: async () => indexBody,
    };
  }) as typeof fetch;
}

describe("/api/pagasa-bulletins", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns the reduced active-bulletin index from upstream", async () => {
    const { __resetPagasaBulletinsCache } = await import(
      "@/lib/pagasa-bulletins"
    );
    __resetPagasaBulletinsCache();
    const { GET } = await import("./route");
    global.fetch = mockUpstream({
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
    });

    const res = await GET(new Request("http://localhost/api/pagasa-bulletins"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(true);
    expect(body.pagasaBulletins.hasActive).toBe(true);
    expect(body.pagasaBulletins.quiet).toBe(false);
    expect(body.pagasaBulletins.indexAgeSeconds).toBe(45);
    expect(body.pagasaBulletins.bulletins[0].name).toBe("Ester");
    expect(body.pagasaBulletins.bulletins[0].number).toBe(6);
  });

  it("returns ok:false payload when upstream fails and no stale snapshot exists", async () => {
    const { __resetPagasaBulletinsCache } = await import(
      "@/lib/pagasa-bulletins"
    );
    __resetPagasaBulletinsCache();
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("severe-weather-bulletin")) {
        return { ok: true, text: async () => ACTIVE_SWB_HTML };
      }
      return { ok: false, status: 503 };
    }) as typeof fetch;

    const res = await GET(new Request("http://localhost/api/pagasa-bulletins"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.ok).toBe(false);
    expect(body.pagasaBulletins).toBeNull();
  });

  it("honors refresh=1 by bypassing the in-process cache", async () => {
    const { __resetPagasaBulletinsCache } = await import(
      "@/lib/pagasa-bulletins"
    );
    __resetPagasaBulletinsCache();

    const fetchMock = mockUpstream({
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
    });
    global.fetch = fetchMock;

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/pagasa-bulletins"));
    await GET(
      new Request("http://localhost/api/pagasa-bulletins?refresh=1"),
    );

    // Each request hits the index + SWB page.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
