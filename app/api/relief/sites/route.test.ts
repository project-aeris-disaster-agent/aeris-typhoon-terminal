/** @jest-environment node */

jest.mock("@/lib/session-auth", () => ({
  getSessionAerisRole: jest.fn(),
}));
jest.mock("@/lib/relief-ops", () => {
  const actual = jest.requireActual("@/lib/relief-ops");
  return { ...actual, getOperation: jest.fn(), insertSite: jest.fn() };
});
jest.mock("@/lib/request-api", () => {
  const actual = jest.requireActual("@/lib/request-api");
  return { ...actual, getRequestEvent: jest.fn() };
});

import { POST } from "./route";
import { getSessionAerisRole } from "@/lib/session-auth";
import { getOperation, insertSite } from "@/lib/relief-ops";
import { getRequestEvent, RequestApiError } from "@/lib/request-api";

const mockRole = getSessionAerisRole as jest.Mock;
const mockGetOperation = getOperation as jest.Mock;
const mockInsertSite = insertSite as jest.Mock;
const mockGetEvent = getRequestEvent as jest.Mock;

const OP_ID = "11111111-1111-4111-8111-111111111111";
const VALID = {
  operationId: OP_ID,
  requestEventUrl: "https://request.example/events/0s1Q73YjSj0qH7",
  barangay: "Triangulo",
  pickupPoint: "Covered Court",
  lat: 13.62,
  lon: 123.19,
  pickupStart: "2026-11-28T02:00:00.000Z",
  pickupEnd: "2026-11-28T04:00:00.000Z",
  pack: "Relief Pack A",
};

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/relief/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/relief/sites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REQUEST_API_KEY = "rq_test_abc";
    mockRole.mockResolvedValue({ userId: "did:privy:admin", role: "admin" });
    mockGetOperation.mockResolvedValue({ id: OP_ID, status: "active" });
    mockGetEvent.mockResolvedValue({ id: "0s1Q73YjSj0qH7", title: "Relief Pack A" });
    mockInsertSite.mockImplementation(async (input) => ({ id: "site-1", ...input }));
  });

  it("rejects a signed-out caller", async () => {
    mockRole.mockResolvedValue({ userId: null, role: "guest_viewer" });
    expect((await call(VALID)).status).toBe(401);
    expect(mockInsertSite).not.toHaveBeenCalled();
  });

  it("rejects a volunteer", async () => {
    mockRole.mockResolvedValue({ userId: "did:privy:vol", role: "volunteer" });
    expect((await call(VALID)).status).toBe(403);
    expect(mockInsertSite).not.toHaveBeenCalled();
  });

  it("links a ReQuest event after checking it exists", async () => {
    const res = await call(VALID);
    expect(res.status).toBe(201);
    expect(mockGetEvent).toHaveBeenCalledWith("0s1Q73YjSj0qH7");
    expect(mockInsertSite).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: OP_ID,
        requestEventId: "0s1Q73YjSj0qH7",
        barangay: "Triangulo",
        lat: 13.62,
        lon: 123.19,
        createdBy: "did:privy:admin",
      }),
    );
  });

  it("saves the link without checking ReQuest when no key is set (link-only mode)", async () => {
    delete process.env.REQUEST_API_KEY;
    const res = await call(VALID);
    expect(res.status).toBe(201);
    expect(mockGetEvent).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.eventTitle).toBeNull();
    expect(mockInsertSite).toHaveBeenCalledWith(
      expect.objectContaining({
        requestEventId: "0s1Q73YjSj0qH7",
        requestEventUrl: VALID.requestEventUrl,
      }),
    );
  });

  it("still refuses an http link in link-only mode", async () => {
    delete process.env.REQUEST_API_KEY;
    const res = await call({ ...VALID, requestEventUrl: "http://request.example/events/0s1Q73YjSj0qH7" });
    expect(res.status).toBe(400);
    expect(mockInsertSite).not.toHaveBeenCalled();
  });

  it("refuses an http link", async () => {
    const res = await call({ ...VALID, requestEventUrl: "http://request.example/events/0s1Q73YjSj0qH7" });
    expect(res.status).toBe(400);
  });

  it("refuses coordinates outside the Philippines", async () => {
    const res = await call({ ...VALID, lat: 35.6, lon: 139.7 });
    expect(res.status).toBe(400);
    expect(mockInsertSite).not.toHaveBeenCalled();
  });

  it("refuses a pickup window that ends before it starts", async () => {
    const res = await call({ ...VALID, pickupEnd: "2026-11-28T01:00:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("refuses a closed operation", async () => {
    mockGetOperation.mockResolvedValue({ id: OP_ID, status: "closed" });
    expect((await call(VALID)).status).toBe(409);
    expect(mockGetEvent).not.toHaveBeenCalled();
  });

  it("explains an event outside the key's allowlist", async () => {
    mockGetEvent.mockRejectedValue(
      new RequestApiError({ status: 403, code: "FORBIDDEN", message: "not in allowlist" }),
    );
    const res = await call(VALID);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issue).toBe("not_allowlisted");
    expect(body.error).toMatch(/allowlist/);
    expect(mockInsertSite).not.toHaveBeenCalled();
  });
});
