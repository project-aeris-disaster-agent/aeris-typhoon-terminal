/** @jest-environment node */
export {};

import { NextRequest } from "next/server";

const originalFetch = global.fetch;

describe("/api/osm-context", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("rejects invalid bounding boxes", async () => {
    const { GET } = await import("./route");

    const missing = await GET(new NextRequest("http://localhost/api/osm-context"));
    const invalid = await GET(
      new NextRequest("http://localhost/api/osm-context?bbox=1,2,3&zoom=12"),
    );

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "Missing bbox query param.",
    });
    await expect(invalid.json()).resolves.toEqual({
      error: "Invalid bbox query param.",
    });
  });

  it("returns normalized roads, buildings, water, and facilities from Overpass elements", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          {
            type: "way",
            id: 1,
            geometry: [
              { lat: 14.5, lon: 121.0 },
              { lat: 14.51, lon: 121.01 },
            ],
            tags: { highway: "primary", name: "EDSA" },
          },
          {
            type: "way",
            id: 2,
            geometry: [
              { lat: 14.5, lon: 121.0 },
              { lat: 14.5, lon: 121.01 },
              { lat: 14.51, lon: 121.01 },
              { lat: 14.5, lon: 121.0 },
            ],
            tags: { building: "government", name: "City Hall" },
          },
          {
            type: "way",
            id: 3,
            geometry: [
              { lat: 14.52, lon: 121.02 },
              { lat: 14.52, lon: 121.03 },
              { lat: 14.53, lon: 121.03 },
              { lat: 14.52, lon: 121.02 },
            ],
            tags: { natural: "water" },
          },
          {
            type: "node",
            id: 4,
            lat: 14.54,
            lon: 121.04,
            tags: { amenity: "hospital", name: "General Hospital" },
          },
        ],
      }),
    }) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/osm-context?bbox=120.9,14.4,121.1,14.6&zoom=12",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.roads.features).toHaveLength(1);
    expect(body.buildings.features).toHaveLength(1);
    expect(body.water.features).toHaveLength(1);
    expect(body.facilities.features).toHaveLength(2);
    expect(body.facilities.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            name: "General Hospital",
            category: "hospital",
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            name: "City Hall",
            category: "government",
          }),
        }),
      ]),
    );
  });

  it("returns 502 when Overpass responds with an invalid payload", async () => {
    const { GET } = await import("./route");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: null }),
    }) as typeof fetch;

    const response = await GET(
      new NextRequest(
        "http://localhost/api/osm-context?bbox=121.2,14.4,121.3,14.5&zoom=12",
      ),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "OpenStreetMap context payload was invalid.",
    });
  });
});
