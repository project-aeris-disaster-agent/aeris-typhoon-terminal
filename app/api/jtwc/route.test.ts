/** @jest-environment node */
export {};

const originalFetch = global.fetch;

jest.mock("@/lib/pagasa-daily", () => {
  const actual = jest.requireActual<typeof import("@/lib/pagasa-daily")>(
    "@/lib/pagasa-daily",
  );
  return {
    ...actual,
    fetchPagasaDailyWeather: jest.fn().mockResolvedValue(null),
  };
});

const RSS_WITH_TC = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Red notification for tropical cyclone SINLAKU-26.</title>
  <description>SINLAKU tropical cyclone affecting PH.</description>
  <link>https://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=1001270</link>
  <pubDate>Thu, 09 Apr 2026 02:21:25 GMT</pubDate>
  <guid isPermaLink="false">TC1001270</guid>
  <geo:Point><geo:lat>15.0</geo:lat><geo:long>125.0</geo:long></geo:Point>
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

  it("maps current GDACS severitydata into wind and category", async () => {
    const { GET } = await import("./route");
    const collection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [125.0, 14.0] },
          properties: {
            eventid: 1001272,
            eventname: "JANGMI-26",
            alertlevel: "Green",
            severitydata: {
              severity: 166.6656,
              severitytext:
                "Tropical Depression (maximum wind speed of 167 km/h)",
              severityunit: "km/h",
            },
          },
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
      expect.objectContaining({
        id: "1001272",
        name: "JANGMI-26",
        windKph: 167,
        category: "Tropical Depression",
        pressureHpa: 0,
        position: [125.0, 14.0],
      }),
    ]);
    expect(body.outsidePar).toBeNull();
    expect(body.outsideParGdacs).toEqual([]);
  });

  it("returns PAGASA outside-PAR advisory alongside in-PAR GDACS storms", async () => {
    const { fetchPagasaDailyWeather } = await import("@/lib/pagasa-daily");
    (fetchPagasaDailyWeather as jest.Mock).mockResolvedValueOnce({
      issuedAt: "3:00 PM, 27 May 2026",
      tcOutsidePar: {
        name: "TROPICAL STORM JANGMI (2606)",
        location:
          "1,260 KM EAST OF EASTERN VISAYAS (10.0°N, 137.2°E)",
        maxWindsKmh: "65 KM/H NEAR THE CENTER",
        gustinessKmh: "UP TO 80 KM/H",
        movement: "NORTHWESTWARD AT 20 KM/H",
      },
    });

    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [137.5, 9.6] },
            properties: {
              eventid: 1001272,
              eventname: "JANGMI-26",
              severitydata: {
                severity: 166.6656,
                severitytext:
                  "Tropical Depression (maximum wind speed of 167 km/h)",
                severityunit: "km/h",
              },
            },
          },
        ],
      }),
    }) as typeof fetch;

    const body = await (await GET()).json();

    expect(body.storms).toEqual([]);
    expect(body.outsideParGdacs).toEqual([]);
    expect(body.outsidePar).toMatchObject({
      source: "pagasa",
      name: "TROPICAL STORM JANGMI (2606)",
      windKph: 65,
      position: [137.2, 10.0],
      issuedAt: "3:00 PM, 27 May 2026",
    });
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
    expect(body.outsidePar).toBeNull();
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
      position: [125.0, 15.0],
      windKph: 93,
      category: "Tropical Storm",
    });
    expect(body.storms[0].bestTrack[0].position).toEqual([125.0, 15.0]);
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
