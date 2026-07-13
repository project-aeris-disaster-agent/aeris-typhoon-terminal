/** @jest-environment node */

const mockedGetHistory = jest.fn();

jest.mock("@/lib/minds-client", () => ({
  mindsClientAvailable: jest.fn(),
  getMindsClient: jest.fn(() => ({ getHistory: mockedGetHistory })),
  describeMindsApiError: jest.fn(() => "boom"),
}));

import { NextRequest } from "next/server";
import { mindsClientAvailable } from "@/lib/minds-client";
import { GET } from "./route";

const mockedAvailable = mindsClientAvailable as jest.MockedFunction<
  typeof mindsClientAvailable
>;

describe("GET /api/internal/minds/activity", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.MINDS_API_SECRET = "activity-secret";
    mockedAvailable.mockReturnValue(true);
    mockedGetHistory.mockResolvedValue([
      {
        fingerprint: "fp-1",
        messageId: "m-1",
        messageText: "Watch digest sent.",
        createdAt: "2026-07-13T00:00:00.000Z",
        partyId: "mind",
      },
    ]);
  });

  afterEach(() => {
    process.env = env;
    jest.clearAllMocks();
  });

  it("returns 401 without authorization", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/activity"),
    );
    expect(res.status).toBe(401);
  });

  it("returns recent history for the watch alias", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/activity?limit=5", {
        headers: { authorization: "Bearer activity-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alias).toBe("aeris-watch");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].messageText).toBe("Watch digest sent.");
    expect(mockedGetHistory).toHaveBeenCalledWith("aeris-watch", { limit: 5 });
  });

  it("returns 503 when Minds is unconfigured", async () => {
    mockedAvailable.mockReturnValue(false);
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/activity", {
        headers: { authorization: "Bearer activity-secret" },
      }),
    );
    expect(res.status).toBe(503);
  });
});
