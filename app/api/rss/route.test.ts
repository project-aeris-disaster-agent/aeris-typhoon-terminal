/** @jest-environment node */
export {};

const originalFetch = global.fetch;

describe("/api/rss", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("fetches tier-1 feeds, filters relevant items, sorts them, and reports feed errors", async () => {
    const { GET } = await import("./route");

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("rappler")) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <rss><channel>
              <item>
                <title>Typhoon update from Rappler</title>
                <link>https://rappler.com/typhoon</link>
                <pubDate>Thu, 23 Apr 2026 01:00:00 GMT</pubDate>
              </item>
            </channel></rss>
          `,
        });
      }
      if (url.includes("inquirer")) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <rss><channel>
              <item>
                <title>Flood response in Manila</title>
                <link>https://inquirer.net/flood</link>
                <pubDate>Thu, 23 Apr 2026 03:00:00 GMT</pubDate>
              </item>
            </channel></rss>
          `,
        });
      }
      if (url.includes("abs-cbn")) {
        return Promise.resolve({
          ok: false,
          status: 500,
        });
      }
      return Promise.resolve({
        ok: true,
        text: async () => `
          <rss><channel>
            <item>
              <title>Sports headline</title>
              <link>https://example.com/sports</link>
              <pubDate>Thu, 23 Apr 2026 02:00:00 GMT</pubDate>
            </item>
          </channel></rss>
        `,
      });
    }) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toEqual([
      {
        id: expect.stringMatching(/^Inquirer\.net-/),
        source: "Inquirer.net",
        title: "Flood response in Manila",
        url: "https://inquirer.net/flood",
        publishedAt: "2026-04-23T03:00:00.000Z",
      },
      {
        id: expect.stringMatching(/^Rappler-/),
        source: "Rappler",
        title: "Typhoon update from Rappler",
        url: "https://rappler.com/typhoon",
        publishedAt: "2026-04-23T01:00:00.000Z",
      },
    ]);
    expect(body.errors).toContain("abscbn: ABS-CBN News 500");
  });
});
