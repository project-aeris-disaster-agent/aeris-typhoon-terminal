/** @jest-environment node */

import { NextRequest } from "next/server";
import { store } from "@/lib/kv";
import { PH_BBOX } from "@/config/region";

const REPORTS_KEY = "reports:list";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function makeRequest(body: unknown, ip = "10.0.0.1") {
  return new NextRequest("http://localhost/api/reports", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("/api/reports", () => {
  beforeEach(async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await store.ltrim(REPORTS_KEY, 1, 0);
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_SERVICE_ROLE_KEY;
  });

  it("creates a report, sanitizes the description, stores the hashed ip, and hides private fields", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        category: "flood",
        description: " <b>Flooded</b>\nroad near school \u0000 ",
        position: [120.9842, 14.5995],
        photoUrl: "https://example.com/photo.jpg",
      }),
    );

    const body = await response.json();
    const stored = await store.lrange(REPORTS_KEY, 0, -1);
    const saved = JSON.parse(stored[0]);

    expect(response.status).toBe(201);
    expect(body.report).toEqual({
      id: expect.any(String),
      category: "flood",
      description: "Flooded road near school",
      position: [120.9842, 14.5995],
      photoUrl: "https://example.com/photo.jpg",
      createdAt: expect.any(String),
      confirmations: 0,
    });
    expect(body.report.ipHash).toBeUndefined();
    expect(saved.ipHash).toMatch(/^[a-f0-9]{16}$/);
    expect(saved.description).toBe("Flooded road near school");
  });

  it("accepts reports exactly on the Philippines bounding box boundary", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        category: "road_closed",
        description: "Road blocked at boundary",
        position: [PH_BBOX[0], PH_BBOX[1]],
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      report: expect.objectContaining({
        category: "road_closed",
        position: [PH_BBOX[0], PH_BBOX[1]],
      }),
    });
  });

  it("rejects invalid json, invalid categories, spam, out-of-bounds coordinates, and unsafe photo urls", async () => {
    const { POST } = await import("./route");

    const invalidJson = await POST(makeRequest("{", "10.0.0.2"));
    const invalidCategory = await POST(
      makeRequest(
        {
          category: "typhoon",
          description: "Real event",
          position: [120.9842, 14.5995],
        },
        "10.0.0.3",
      ),
    );
    const spam = await POST(
      makeRequest(
        {
          category: "flood",
          description: "crypto giveaway casino",
          position: [120.9842, 14.5995],
        },
        "10.0.0.4",
      ),
    );
    const outside = await POST(
      makeRequest(
        {
          category: "flood",
          description: "Outside PH",
          position: [140, 30],
        },
        "10.0.0.5",
      ),
    );
    const badPhoto = await POST(
      makeRequest(
        {
          category: "flood",
          description: "Unsafe photo url",
          position: [120.9842, 14.5995],
          photoUrl: "javascript:alert(1)",
        },
        "10.0.0.6",
      ),
    );

    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: "Invalid JSON" });
    expect(await invalidCategory.json()).toEqual({ error: "Invalid category." });
    expect(await spam.json()).toEqual({ error: "Report rejected." });
    expect(await outside.json()).toEqual({ error: "Coordinates outside Philippines." });
    expect(await badPhoto.json()).toEqual({ error: "Invalid photo URL." });
  });

  it("enforces rate limits for concurrent submissions from the same ip", async () => {
    const { POST } = await import("./route");
    const requests = Array.from({ length: 6 }, () =>
      POST(
        makeRequest(
          {
            category: "flood",
            description: "Flood depth rising quickly",
            position: [120.9842, 14.5995],
          },
          "10.0.0.7",
        ),
      ),
    );

    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect(bodies).toContainEqual(
      expect.objectContaining({
        error: "Rate limit exceeded. Try again in a few minutes.",
        resetSeconds: expect.any(Number),
      }),
    );
  });

  it("returns only valid, unexpired public reports on GET", async () => {
    const { GET } = await import("./route");

    await store.lpush(
      REPORTS_KEY,
      JSON.stringify({
        id: "fresh",
        category: "flood",
        description: "Fresh report",
        position: [120.9842, 14.5995],
        createdAt: new Date().toISOString(),
        confirmations: 2,
        ipHash: "deadbeefdeadbeef",
      }),
    );
    await store.lpush(
      REPORTS_KEY,
      JSON.stringify({
        id: "expired",
        category: "flood",
        description: "Expired report",
        position: [120.9842, 14.5995],
        createdAt: "2020-01-01T00:00:00.000Z",
        confirmations: 1,
        ipHash: "deadbeefdeadbeef",
      }),
    );
    await store.lpush(REPORTS_KEY, "{not-json");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      reports: [
        {
          id: "fresh",
          category: "flood",
          description: "Fresh report",
          position: [120.9842, 14.5995],
          createdAt: expect.any(String),
          confirmations: 2,
        },
      ],
    });
  });
});
