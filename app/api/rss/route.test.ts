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

  it("aggregates tier-1 feeds, ranks weather/disaster headlines, and reports feed errors", async () => {
    const { GET } = await import("./route");

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("google")) {
        return Promise.resolve({
          ok: true,
          text: async () => `
            <rss><channel>
              <item>
                <title>PAGASA monitors LPA east of Mindanao - GMA News</title>
                <link>https://news.google.com/articles/lpa</link>
                <pubDate>Thu, 26 May 2026 04:00:00 GMT</pubDate>
              </item>
            </channel></rss>
          `,
        });
      }
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
    expect(body.errors).toEqual([]);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(body.items.some((item: { title: string }) => item.title.includes("PAGASA"))).toBe(
      true,
    );
    expect(body.items.some((item: { source: string }) => item.source === "GMA News")).toBe(
      true,
    );
  });
});
