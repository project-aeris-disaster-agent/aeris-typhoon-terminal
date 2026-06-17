/** @jest-environment node */
export {};

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

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pagasaBulletins.hasActive).toBe(true);
    expect(body.pagasaBulletins.bulletins[0].name).toBe("Ester");
    expect(body.pagasaBulletins.bulletins[0].number).toBe(6);
  });

  it("returns ok:false payload when upstream fails", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as typeof fetch;

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.pagasaBulletins).toBeNull();
  });
});
