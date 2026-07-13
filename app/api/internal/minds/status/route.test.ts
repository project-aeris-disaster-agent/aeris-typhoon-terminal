/** @jest-environment node */

jest.mock("@/lib/minds-client", () => ({
  mindsClientAvailable: jest.fn(),
  getMindDetails: jest.fn(),
  getCognitionStatus: jest.fn(),
  describeMindsApiError: jest.fn(() => "boom"),
}));

import { NextRequest } from "next/server";
import {
  getCognitionStatus,
  getMindDetails,
  mindsClientAvailable,
} from "@/lib/minds-client";
import { GET } from "./route";

const mockedAvailable = mindsClientAvailable as jest.MockedFunction<
  typeof mindsClientAvailable
>;
const mockedMind = getMindDetails as jest.MockedFunction<typeof getMindDetails>;
const mockedCognition = getCognitionStatus as jest.MockedFunction<
  typeof getCognitionStatus
>;

describe("GET /api/internal/minds/status", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    process.env.MINDS_API_SECRET = "status-secret";
    process.env.MINDS_NOTIFY_ENABLED = "true";
    mockedAvailable.mockReturnValue(true);
    mockedMind.mockResolvedValue({
      mindId: "mind-1",
      name: "AERIS Watch Officer",
      isEnabled: true,
    });
    mockedCognition.mockResolvedValue({
      balance: { mindId: "mind-1", cognition: 500 },
      warnThreshold: 100,
      low: false,
    });
  });

  afterEach(() => {
    process.env = env;
    jest.clearAllMocks();
  });

  it("returns 401 without authorization", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/status"),
    );
    expect(res.status).toBe(401);
  });

  it("returns mind + cognition status when authorized", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/status", {
        headers: { authorization: "Bearer status-secret" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.mind.mindId).toBe("mind-1");
    expect(body.cognition.balance).toBe(500);
    expect(body.warnings).toEqual([]);
  });

  it("warns when cognition is low or the mind is disabled", async () => {
    mockedMind.mockResolvedValue({ mindId: "mind-1", isEnabled: false });
    mockedCognition.mockResolvedValue({
      balance: { mindId: "mind-1", cognition: 5 },
      warnThreshold: 100,
      low: true,
    });
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/status", {
        headers: { authorization: "Bearer status-secret" },
      }),
    );
    const body = await res.json();
    expect(body.warnings).toHaveLength(2);
    expect(body.cognition.low).toBe(true);
  });

  it("reports unconfigured without calling the API", async () => {
    mockedAvailable.mockReturnValue(false);
    const res = await GET(
      new NextRequest("http://localhost/api/internal/minds/status", {
        headers: { authorization: "Bearer status-secret" },
      }),
    );
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(mockedMind).not.toHaveBeenCalled();
  });
});
