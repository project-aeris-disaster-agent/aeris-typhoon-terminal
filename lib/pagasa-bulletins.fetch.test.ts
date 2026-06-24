/** @jest-environment node */
export {};

import {
  __resetPagasaBulletinsCache,
  fetchPagasaBulletins,
} from "@/lib/pagasa-bulletins";

const originalFetch = global.fetch;

const HEALTHY_FIXTURE = {
  error: false,
  age: 12,
  bulletins: [
    {
      name: "ester",
      count: 6,
      final: false,
      file: "TCB#6_ester.pdf",
      link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%236_ester.pdf",
    },
  ],
};

describe("fetchPagasaBulletins", () => {
  beforeEach(() => {
    __resetPagasaBulletinsCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns a stale snapshot when upstream fails after a healthy fetch", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => HEALTHY_FIXTURE,
      })
      .mockRejectedValueOnce(new Error("upstream down")) as typeof fetch;

    const healthy = await fetchPagasaBulletins();
    expect(healthy?.bulletins[0].name).toBe("Ester");
    expect(healthy?.stale).toBeUndefined();

    const stale = await fetchPagasaBulletins({ bypassCache: true });
    expect(stale?.stale).toBe(true);
    expect(stale?.warning).toContain("most recent successful snapshot");
    expect(stale?.bulletins[0].name).toBe("Ester");
  });
});
