/** @jest-environment node */
export {};

const originalFetch = global.fetch;

function rssItem(inner: string) {
  return `<item>${inner}</item>`;
}

describe("buildAlertsFromGdacsRss", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("includes current PH hazards and drops ended or stale rows", async () => {
    const { buildAlertsFromGdacsRss } = await import("./gdacs-alerts");
    const recent = new Date().toUTCString();
    const stale = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toUTCString();

    const xml = `
      <rss><channel>
        ${rssItem(`
          <title><![CDATA[Green earthquake (Magnitude 5.7M)]]></title>
          <description><![CDATA[On 5/28/2026, an earthquake occurred in the Philippines potentially affecting 100 thousand in MMI IV.]]></description>
          <link>https://gdacs.example/current</link>
          <pubDate>${recent}</pubDate>
          <gdacs:country>Philippines</gdacs:country>
          <gdacs:alertlevel>Green</gdacs:alertlevel>
          <gdacs:iscurrent>true</gdacs:iscurrent>
          <gdacs:eventtype>EQ</gdacs:eventtype>
        `)}
        ${rssItem(`
          <title>Ended flood in Luzon</title>
          <description>Heavy rainfall expected across Luzon and Visayas with possible flooding in low-lying areas for several days.</description>
          <link>https://gdacs.example/ended</link>
          <pubDate>${recent}</pubDate>
          <gdacs:country>Philippines</gdacs:country>
          <gdacs:alertlevel>Orange</gdacs:alertlevel>
          <gdacs:iscurrent>false</gdacs:iscurrent>
          <gdacs:eventtype>FL</gdacs:eventtype>
        `)}
        ${rssItem(`
          <title>Stale hazard in Mindanao</title>
          <description>Heavy rainfall expected across Mindanao with widespread impacts in low-lying areas and river basins.</description>
          <link>https://gdacs.example/stale</link>
          <pubDate>${stale}</pubDate>
          <gdacs:country>Philippines</gdacs:country>
          <gdacs:alertlevel>Orange</gdacs:alertlevel>
          <gdacs:iscurrent>true</gdacs:iscurrent>
          <gdacs:eventtype>FL</gdacs:eventtype>
        `)}
        ${rssItem(`
          <title>Flood in Peru</title>
          <description>Outside monitored region with enough text to pass the minimum summary length requirement.</description>
          <link>https://gdacs.example/peru</link>
          <pubDate>${recent}</pubDate>
          <gdacs:country>Peru</gdacs:country>
          <gdacs:alertlevel>Orange</gdacs:alertlevel>
          <gdacs:iscurrent>true</gdacs:iscurrent>
          <gdacs:eventtype>FL</gdacs:eventtype>
        `)}
      </channel></rss>
    `;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => xml,
    }) as typeof fetch;

    const alerts = await buildAlertsFromGdacsRss();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      source: "GDACS",
      title: "Green earthquake (Magnitude 5.7M)",
      url: "https://gdacs.example/current",
    });
  });

  it("uses the latest advisory (datemodified) for an active TC, not the original pubDate", async () => {
    const { buildAlertsFromGdacsRss } = await import("./gdacs-alerts");
    const created = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toUTCString();
    const lastAdvisory = new Date(Date.now() - 2 * 60 * 60 * 1000).toUTCString();

    const xml = `
      <rss><channel>
        ${rssItem(`
          <title><![CDATA[JANGMI-26]]></title>
          <link>https://gdacs.example/tc</link>
          <pubDate>${created}</pubDate>
          <gdacs:datemodified>${lastAdvisory}</gdacs:datemodified>
          <gdacs:eventid>1000</gdacs:eventid>
          <gdacs:eventname>JANGMI-26</gdacs:eventname>
          <gdacs:eventtype>TC</gdacs:eventtype>
          <gdacs:iscurrent>true</gdacs:iscurrent>
          <gdacs:alertlevel>Red</gdacs:alertlevel>
          <gdacs:severity value="139">Severe tropical storm (maximum wind speed of 139 km/h)</gdacs:severity>
          <geo:lat>14.5</geo:lat>
          <geo:long>125.0</geo:long>
        `)}
      </channel></rss>
    `;

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => xml,
    }) as typeof fetch;

    const alerts = await buildAlertsFromGdacsRss();
    const tc = alerts.find((a) => a.id === "tc-1000");

    expect(tc).toBeDefined();
    expect(tc?.issuedAt).toBe(lastAdvisory);
    expect(tc?.issuedAt).not.toBe(created);
  });
});
