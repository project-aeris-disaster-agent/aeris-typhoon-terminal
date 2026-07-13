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

const ACTIVE_SWB_HTML =
  "<html><body><h3>Tropical Cyclone Bulletin</h3><p>Active system ESTER</p></body></html>";
const QUIET_SWB_HTML = `
<html><body>
  <h3>No Active Tropical Cyclone within the Philippine Area of Responsibility</h3>
  <a href="https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%2316_inday.pdf">TCB#16_inday.pdf</a>
</body></html>`;


function mockFetch(handlers: {
  index?: () => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>;
  swbHtml?: string;
}) {
  return jest.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("severe-weather-bulletin")) {
      return {
        ok: true,
        text: async () => handlers.swbHtml ?? ACTIVE_SWB_HTML,
      };
    }
    if (handlers.index) return handlers.index();
    return {
      ok: true,
      json: async () => HEALTHY_FIXTURE,
    };
  }) as typeof fetch;
}

describe("fetchPagasaBulletins", () => {
  beforeEach(() => {
    __resetPagasaBulletinsCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("returns a stale snapshot when upstream fails after a healthy fetch", async () => {
    let indexCalls = 0;
    global.fetch = mockFetch({
      swbHtml: ACTIVE_SWB_HTML,
      index: async () => {
        indexCalls += 1;
        if (indexCalls === 1) {
          return { ok: true, json: async () => HEALTHY_FIXTURE };
        }
        throw new Error("upstream down");
      },
    });

    const healthy = await fetchPagasaBulletins();
    expect(healthy?.bulletins[0].name).toBe("Ester");
    expect(healthy?.stale).toBeUndefined();
    expect(healthy?.quiet).toBe(false);

    const stale = await fetchPagasaBulletins({ bypassCache: true });
    expect(stale?.stale).toBe(true);
    expect(stale?.warning).toContain("most recent successful snapshot");
    expect(stale?.bulletins[0].name).toBe("Ester");
  });

  it("surfaces the latest SWB archive PDF when PAR is quiet", async () => {
    global.fetch = mockFetch({
      swbHtml: QUIET_SWB_HTML,
      index: async () => ({
        ok: true,
        json: async () => ({
          error: false,
          age: 0,
          bulletins: [
            {
              name: "francisco",
              count: 21,
              final: false,
              file: "TCB#21_francisco.pdf",
              link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%2321_francisco.pdf",
            },
          ],
        }),
      }),
    });

    const out = await fetchPagasaBulletins();
    expect(out?.quiet).toBe(true);
    expect(out?.hasActive).toBe(false);
    expect(out?.bulletins).toHaveLength(1);
    expect(out?.bulletins[0]).toMatchObject({
      name: "Inday",
      number: 16,
      archive: true,
      final: true,
    });
  });
});
