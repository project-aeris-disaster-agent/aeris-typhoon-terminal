/** @jest-environment node */
export {};

const originalFetch = global.fetch;

describe("/api/gdacs", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("filters GDACS RSS items to Philippines-relevant alerts and maps severities", async () => {
    const { GET } = await import("./route");
    const xml = `
      <rss><channel>
        <item>
          <title><![CDATA[Typhoon near Luzon]]></title>
          <description><![CDATA[<b>Heavy rainfall</b> expected across Luzon and Visayas with possible flooding in low-lying areas.]]></description>
          <link>https://gdacs.example/1</link>
          <pubDate>Thu, 23 Apr 2026 00:00:00 GMT</pubDate>
          <gdacs:country>Philippines</gdacs:country>
          <gdacs:alertlevel>Red</gdacs:alertlevel>
        </item>
        <item>
          <title>Flood in Peru</title>
          <description>Outside monitored region</description>
          <link>https://gdacs.example/2</link>
          <pubDate>Thu, 23 Apr 2026 01:00:00 GMT</pubDate>
          <gdacs:country>Peru</gdacs:country>
          <gdacs:alertlevel>Orange</gdacs:alertlevel>
        </item>
      </channel></rss>
    `;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => xml,
    }) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      alerts: [
        expect.objectContaining({
          id: expect.stringMatching(/^gdacs-/),
          source: "GDACS",
          severity: "emergency",
          title: "Typhoon near Luzon",
          summary:
            "Heavy rainfall expected across Luzon and Visayas with possible flooding in low-lying areas.",
          url: "https://gdacs.example/1",
        }),
      ],
    });
  });

  it("builds deterministic ids from stable alert text when link metadata is missing", async () => {
    const { GET } = await import("./route");
    const xml = `
      <rss><channel>
        <item>
          <description>Philippines tropical cyclone advisory with no title or link but enough detail for operators.</description>
        </item>
      </channel></rss>
    `;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => xml,
    }) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alerts).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^gdacs-/),
        summary:
          "Philippines tropical cyclone advisory with no title or link but enough detail for operators.",
      }),
    ]);
  });

  it("degrades gracefully with empty alerts when GDACS fetch fails", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.alerts).toEqual([]);
    expect(body._error).toBe("network down");
  });
});
