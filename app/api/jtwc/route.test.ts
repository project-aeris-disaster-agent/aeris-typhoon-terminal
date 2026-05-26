/** @jest-environment node */
export {};

const originalFetch = global.fetch;

const RSS_WITH_TC = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Red notification for tropical cyclone SINLAKU-26.</title>
  <description>SINLAKU tropical cyclone affecting PH.</description>
  <link>https://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=1001270</link>
  <pubDate>Thu, 09 Apr 2026 02:21:25 GMT</pubDate>
  <guid isPermaLink="false">TC1001270</guid>
  <geo:Point><geo:lat>28.7</geo:lat><geo:long>156.1</geo:long></geo:Point>
  <gdacs:iscurrent>true</gdacs:iscurrent>
  <gdacs:eventtype>TC</gdacs:eventtype>
  <gdacs:alertlevel>Red</gdacs:alertlevel>
  <gdacs:eventname>SINLAKU-26</gdacs:eventname>
  <gdacs:eventid>1001270</gdacs:eventid>
  <gdacs:severity unit="km/h" value="287.0352">Tropical Storm (maximum wind speed of 93 km/h)</gdacs:severity>
</item>
<item>
  <title>Earthquake not tropical</title>
  <description>EQ</description>
  <gdacs:iscurrent>true</gdacs:iscurrent>
  <gdacs:eventtype>EQ</gdacs:eventtype>
  <gdacs:eventid>9999</gdacs:eventid>
  <gdacs:eventname>Test EQ</gdacs:eventname>
  <geo:Point><geo:lat>10</geo:lat><geo:long>120</geo:long></geo:Point>
</item>
<item>
  <title>Archived TC</title>
  <gdacs:iscurrent>false</gdacs:iscurrent>
  <gdacs:eventtype>TC</gdacs:eventtype>
  <gdacs:eventid>1001111</gdacs:eventid>
  <gdacs:eventname>HISTORIC</gdacs:eventname>
  <geo:Point><geo:lat>15</geo:lat><geo:long>120</geo:long></geo:Point>
  <gdacs:severity unit="km/h" value="90">Tropical Storm</gdacs:severity>
</item>
</channel></rss>`;

describe("/api/jtwc", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("maps GDACS storm geometry into the typhoon response shape", async () => {
    const { GET } = await import("./route");
    const collection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [125.6, 14.2] },
          properties: {
            eventid: "storm-1",
            eventname: "Auring",
            severity: "TS",
            wind_speed: 85,
            pressure: 980,
            direction: "NW",
            landfall: "2026-04-24T00:00:00Z",
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [126.0, 14.5],
              [125.6, 14.2],
            ],
          },
          properties: { eventid: "storm-1" },
        },
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => collection,
    }) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.storms).toEqual([
      {
        id: "storm-1",
        name: "Auring",
        localName: null,
        category: "TS",
        position: [125.6, 14.2],
        windKph: 85,
        pressureHpa: 980,
        heading: "NW",
        landfallEta: "2026-04-24T00:00:00Z",
        bestTrack: [
          { position: [126.0, 14.5] },
          { position: [125.6, 14.2] },
        ],
        forecast: [],
      },
    ]);
    expect(body._warning).toBeUndefined();
    expect(body._error).toBeUndefined();
  });

  it("falls back to RSS when the primary GeoJSON endpoint is forbidden", async () => {
    const { GET } = await import("./route");
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => RSS_WITH_TC,
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("gdacs.org/xml/rss.xml");
    expect(body.storms).toHaveLength(1);
    expect(body.storms[0]).toMatchObject({
      id: "1001270",
      name: "SINLAKU-26",
      position: [156.1, 28.7],
      windKph: 287,
      category: "Super Typhoon",
    });
    expect(body.storms[0].bestTrack[0].position).toEqual([156.1, 28.7]);
    expect(body._warning).toBeUndefined();
    expect(body._error).toBeUndefined();
  });

  it("returns the original error when both primary and RSS fallback fail", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error("primary network down"))
      .mockRejectedValueOnce(new Error("rss network down")) as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.storms).toEqual([]);
    expect(body._error).toContain("primary network down");
    expect(body._error).toContain("rss network down");
  });

  it("falls back to RSS when the GeoJSON payload is structurally invalid", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ type: "FeatureCollection", features: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => RSS_WITH_TC,
      }) as unknown as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.storms).toHaveLength(1);
    expect(body._warning).toBeUndefined();
  });

  it("ignores non-TC and archived items in the RSS fallback", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => RSS_WITH_TC,
      }) as unknown as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(body.storms).toHaveLength(1);
    expect(body.storms[0].id).toBe("1001270");
  });
});
