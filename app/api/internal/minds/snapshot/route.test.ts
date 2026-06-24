/** @jest-environment node */

jest.mock("@/lib/agent-context", () => ({
  buildAgentLiveContext: jest.fn(),
}));

import { NextRequest } from "next/server";
import { buildAgentLiveContext } from "@/lib/agent-context";
import { GET } from "./route";

const mockedBuild = buildAgentLiveContext as jest.MockedFunction<
  typeof buildAgentLiveContext
>;

describe("GET /api/internal/minds/snapshot", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.MINDS_API_SECRET = "snapshot-secret";
    mockedBuild.mockResolvedValue({
      generatedAt: "2026-05-27T14:00:00.000Z",
      regionLock: "Philippines",
      verdictDisclaimer: "not TCWS",
      national: {
        verdictLabel: "Monitor",
        verdictTone: "ok",
        verdictReasons: [],
        severityScore: 10,
        briefFacts: [],
        typhoonAlerts: [],
        tcOutsidePar: null,
        worstRegionalAlert: {
          label: "Monitor",
          level: 1,
          score: 10,
          tone: "ok",
        },
        elevatedRivers: [],
      },
      selectedLocation: null,
    });
  });

  afterEach(() => {
    process.env = env;
    jest.clearAllMocks();
  });

  it("returns 401 without authorization", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/snapshot"),
    );
    expect(res.status).toBe(401);
  });

  it("returns live context when authorized", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/snapshot", {
        headers: { authorization: "Bearer snapshot-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedAt).toBe("2026-05-27T14:00:00.000Z");
    expect(body.national.verdictLabel).toBe("Monitor");
    expect(mockedBuild).toHaveBeenCalledWith(null);
  });

  it("passes lat/lon hint to buildAgentLiveContext", async () => {
    const url =
      "http://localhost/api/internal/minds/snapshot?lat=14.6&lon=121.0&name=QC";
    const res = await GET(
      new NextRequest(url, {
        headers: { authorization: "Bearer snapshot-secret" },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockedBuild).toHaveBeenCalledWith({
      name: "QC",
      lat: 14.6,
      lon: 121,
    });
  });
});
