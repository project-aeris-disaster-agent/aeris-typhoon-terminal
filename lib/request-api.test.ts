/** @jest-environment node */

import {
  classifyRequestError,
  getRequestEvent,
  getRequestPassCounts,
  parseRequestEventId,
  readAttendeeTotals,
  RequestApiError,
} from "./request-api";

const fetchMock = jest.fn();

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.REQUEST_API_KEY = "rq_test_abc";
  delete process.env.REQUEST_API_BASE_URL;
});

afterAll(() => {
  delete process.env.REQUEST_API_KEY;
});

describe("parseRequestEventId", () => {
  it("accepts a bare id", () => {
    expect(parseRequestEventId("0s1Q73YjSj0qH7")).toBe("0s1Q73YjSj0qH7");
  });

  it("reads the last id-like path segment of a link", () => {
    expect(parseRequestEventId("https://request.example/events/0s1Q73YjSj0qH7")).toBe(
      "0s1Q73YjSj0qH7",
    );
    expect(parseRequestEventId("https://request.example/e/0s1Q73YjSj0qH7/details")).toBe(
      "0s1Q73YjSj0qH7",
    );
  });

  it("prefers an explicit event query parameter", () => {
    expect(parseRequestEventId("https://request.example/checkout?event=abcDEF123")).toBe(
      "abcDEF123",
    );
  });

  it("rejects text that is neither an id nor a link", () => {
    expect(parseRequestEventId("not an id!")).toBeNull();
    expect(parseRequestEventId("")).toBeNull();
  });
});

describe("readAttendeeTotals", () => {
  it("reads a nested totals block", () => {
    expect(readAttendeeTotals({ attendees: [{}], totals: { total: 420, checked_in: 210 } })).toEqual({
      total: 420,
      checkedIn: 210,
    });
  });

  it("reads nested { total } objects", () => {
    expect(readAttendeeTotals({ summary: { attendees: { total: 9 }, checked_in: { total: 4 } } })).toEqual({
      total: 9,
      checkedIn: 4,
    });
  });

  it("does not mistake a top-level page count for the event total", () => {
    expect(readAttendeeTotals({ attendees: [{}], count: 1 })).toEqual({ total: null, checkedIn: null });
    expect(readAttendeeTotals({ attendees: [{}], count: 1, total: 380 }).total).toBe(380);
  });

  it("ignores negative and non-numeric values", () => {
    expect(readAttendeeTotals({ totals: { total: -3, checked_in: "12" } })).toEqual({
      total: null,
      checkedIn: null,
    });
  });
});

describe("getRequestPassCounts", () => {
  it("uses totals from a single call when they include checked-in", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { totals: { total: 420, checked_in: 210 } }));
    await expect(getRequestPassCounts("evt123456")).resolves.toEqual({ issued: 420, claimed: 210 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://requestprod-6gasihacrq-uc.a.run.app/v1/events/evt123456/attendees?status=ACTIVE&limit=1",
    );
    expect(init.headers.authorization).toBe("Bearer rq_test_abc");
  });

  it("makes a checked_in=true call when the first response has no checked-in figure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { totals: { total: 300 } }))
      .mockResolvedValueOnce(jsonResponse(200, { totals: { total: 120 } }));
    await expect(getRequestPassCounts("evt123456")).resolves.toEqual({ issued: 300, claimed: 120 });
    expect(String(fetchMock.mock.calls[1][0])).toContain("checked_in=true");
  });

  it("fails loudly on an unrecognized shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { attendees: [] }));
    await expect(getRequestPassCounts("evt123456")).rejects.toMatchObject({
      code: "UNRECOGNIZED_SHAPE",
    });
  });

  it("surfaces ReQuest's error envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, {
        error: { code: "AUTH_SCOPE", message: "event not in allowlist", retryable: false },
      }),
    );
    const err = await getRequestPassCounts("evt123456").catch((e) => e);
    expect(err).toBeInstanceOf(RequestApiError);
    expect(err.status).toBe(403);
    expect(classifyRequestError(err)).toBe("not_allowlisted");
  });

  it("reports not_configured without calling ReQuest when the key is missing", async () => {
    delete process.env.REQUEST_API_KEY;
    const err = await getRequestPassCounts("evt123456").catch((e) => e);
    expect(classifyRequestError(err)).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getRequestEvent", () => {
  it("reads the event title", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { event: { title: "Relief Pack A — Triangulo" } }));
    await expect(getRequestEvent("evt123456")).resolves.toEqual({
      id: "evt123456",
      title: "Relief Pack A — Triangulo",
    });
  });

  it("maps a 404 to not_found", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: { code: "NOT_FOUND", message: "nope" } }));
    const err = await getRequestEvent("evt123456").catch((e) => e);
    expect(classifyRequestError(err)).toBe("not_found");
  });
});
