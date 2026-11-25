/** @jest-environment node */

jest.mock("@/lib/rate-limit", () => ({
  getClientIp: jest.fn(() => "1.2.3.4"),
  rateLimit: jest.fn(async () => ({ allowed: true, remaining: 59, resetSeconds: 60 })),
}));
jest.mock("@/lib/request-api", () => {
  const actual = jest.requireActual("@/lib/request-api");
  return { ...actual, getRequestPassCounts: jest.fn() };
});

import { GET } from "./route";
import { getRequestPassCounts, RequestApiError } from "@/lib/request-api";
import { resetReliefCountsCache } from "@/lib/relief-ops";

const mockCounts = getRequestPassCounts as jest.Mock;
const fetchMock = jest.fn();

const OP = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Typhoon Pepito relief",
  lgu: "Naga City",
  incident_ref: "Pepito",
  status: "active",
  created_by: "did:privy:admin",
  created_at: "2026-11-24T00:00:00Z",
  closed_at: null,
};

function site(id: string, eventId: string, barangay: string) {
  return {
    id,
    operation_id: OP.id,
    request_event_id: eventId,
    request_event_url: `https://request.example/events/${eventId}`,
    barangay,
    psgc_code: null,
    pickup_point: "Covered Court",
    lat: 13.62,
    lon: 123.19,
    pickup_start: null,
    pickup_end: null,
    pack_description: "Pack A",
    created_by: "did:privy:admin",
    created_at: "2026-11-24T00:00:00Z",
  };
}

function rest(body: unknown, status = 200) {
  return {
    ok: status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetReliefCountsCache();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.REQUEST_API_KEY = "rq_test_abc";
});

describe("GET /api/relief/operations", () => {
  it("returns an empty, unconfigured board when Supabase is not set up", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await GET(new Request("http://localhost/api/relief/operations"));
    const body = await res.json();
    expect(body.configured.store).toBe(false);
    expect(body.operations).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats missing relief tables as not set up", async () => {
    fetchMock.mockResolvedValueOnce(
      rest({ code: "PGRST205", message: "Could not find the table 'public.relief_operations'" }, 404),
    );
    const res = await GET(new Request("http://localhost/api/relief/operations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured.store).toBe(false);
    expect(body.operations).toEqual([]);
  });

  it("merges ReQuest counts into sites and totals only the sites that reported", async () => {
    fetchMock
      .mockResolvedValueOnce(rest([OP]))
      .mockResolvedValueOnce(
        rest([site("s1", "evtAAAAAA1", "Triangulo"), site("s2", "evtBBBBBB2", "Sabang")]),
      );
    mockCounts.mockImplementation(async (eventId: string) => {
      if (eventId === "evtAAAAAA1") return { issued: 420, claimed: 210 };
      throw new RequestApiError({ status: 403, code: "FORBIDDEN", message: "allowlist" });
    });

    const res = await GET(new Request("http://localhost/api/relief/operations"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const [op] = body.operations;
    expect(op.totals).toEqual({ issued: 420, claimed: 210, sitesReporting: 1, sitesTotal: 2 });
    expect(op.sites[1].countsIssue).toBe("not_allowlisted");
    expect(op.sites[1].counts).toBeNull();
  });

  it("lists sites without calling ReQuest when no key is set (link-only mode)", async () => {
    delete process.env.REQUEST_API_KEY;
    fetchMock
      .mockResolvedValueOnce(rest([OP]))
      .mockResolvedValueOnce(rest([site("s1", "evtAAAAAA1", "Triangulo")]));
    const body = await (await GET(new Request("http://localhost/api/relief/operations"))).json();
    expect(mockCounts).not.toHaveBeenCalled();
    expect(body.configured).toEqual({ store: true, request: false });
    const [op] = body.operations;
    expect(op.sites[0]).toMatchObject({
      requestEventUrl: "https://request.example/events/evtAAAAAA1",
      counts: null,
      countsIssue: null,
    });
    expect(op.totals).toEqual({ issued: 0, claimed: 0, sitesReporting: 0, sitesTotal: 1 });
  });

  it("caches counts per event between refreshes", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("relief_operations") ? rest([OP]) : rest([site("s1", "evtAAAAAA1", "Triangulo")]),
    );
    mockCounts.mockResolvedValue({ issued: 10, claimed: 4 });
    await GET(new Request("http://localhost/api/relief/operations"));
    await GET(new Request("http://localhost/api/relief/operations"));
    expect(mockCounts).toHaveBeenCalledTimes(1);
  });

  it("never exposes created_by in the site view", async () => {
    fetchMock
      .mockResolvedValueOnce(rest([OP]))
      .mockResolvedValueOnce(rest([site("s1", "evtAAAAAA1", "Triangulo")]));
    mockCounts.mockResolvedValue({ issued: 10, claimed: 4 });
    const body = await (await GET(new Request("http://localhost/api/relief/operations"))).json();
    expect(JSON.stringify(body)).not.toContain("did:privy:admin");
  });
});
