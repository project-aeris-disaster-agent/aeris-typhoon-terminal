/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/session-user", () => ({
  resolveSessionUserId: jest.fn(),
}));
jest.mock("@/lib/supabase-reports", () => ({
  getSupabaseReportById: jest.fn(),
}));
jest.mock("@/lib/report-votes", () => ({
  reportVotesEnabled: jest.fn(() => true),
  upsertReportVote: jest.fn(),
}));
jest.mock("@/lib/gamification", () => ({
  awardXp: jest.fn(),
}));

import { POST } from "./route";
import { resolveSessionUserId } from "@/lib/session-user";
import { getSupabaseReportById } from "@/lib/supabase-reports";
import { reportVotesEnabled, upsertReportVote } from "@/lib/report-votes";
import { awardXp } from "@/lib/gamification";

const mockSession = resolveSessionUserId as jest.Mock;
const mockGetReport = getSupabaseReportById as jest.Mock;
const mockEnabled = reportVotesEnabled as jest.Mock;
const mockUpsert = upsertReportVote as jest.Mock;
const mockAwardXp = awardXp as jest.Mock;

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const VOTER = "did:privy:voter";

function makeRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/reports/${REPORT_ID}/vote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function callRoute(body: unknown) {
  return POST(makeRequest(body), {
    params: Promise.resolve({ id: REPORT_ID }),
  });
}

function baseReport(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    category: "flood",
    description: "Flooded road",
    position: [120.98, 14.6],
    createdAt: new Date().toISOString(),
    confirmations: 0,
    verificationStatus: "unverified",
    reporterUserId: "did:privy:someone-else",
    ...overrides,
  };
}

describe("POST /api/reports/[id]/vote", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnabled.mockReturnValue(true);
    mockSession.mockResolvedValue(VOTER);
    mockGetReport.mockResolvedValue(baseReport());
    mockUpsert.mockResolvedValue(true);
    mockAwardXp.mockResolvedValue({
      xp: 55,
      level: 1,
      leveledUp: true,
      awarded: true,
    });
  });

  it("requires authentication", async () => {
    mockSession.mockResolvedValue(null);
    const res = await callRoute({ vote: "up" });
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects invalid vote values and invalid JSON", async () => {
    const invalidValue = await callRoute({ vote: "sideways" });
    expect(invalidValue.status).toBe(400);

    const invalidJson = await callRoute("{");
    expect(invalidJson.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown reports", async () => {
    mockGetReport.mockResolvedValue(null);
    const res = await callRoute({ vote: "up" });
    expect(res.status).toBe(404);
  });

  it("closes voting once the report is decided", async () => {
    for (const verificationStatus of ["verified", "rejected", "duplicate"]) {
      mockGetReport.mockResolvedValue(baseReport({ verificationStatus }));
      const res = await callRoute({ vote: "down" });
      expect(res.status).toBe(409);
    }
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("forbids voting on your own report", async () => {
    mockGetReport.mockResolvedValue(baseReport({ reporterUserId: VOTER }));
    const res = await callRoute({ vote: "up" });
    expect(res.status).toBe(403);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("records the vote and awards vote_report XP with a per-report dedupe key", async () => {
    const res = await callRoute({ vote: "up" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(REPORT_ID, VOTER, "up");
    expect(mockAwardXp).toHaveBeenCalledWith(VOTER, "vote_report", {
      refId: REPORT_ID,
      dedupeKey: `vote_report:${REPORT_ID}:${VOTER}`,
    });
    expect(body).toEqual({
      vote: "up",
      awarded: true,
      xp: 55,
      level: 1,
      leveledUp: true,
    });
  });

  it("does not re-award XP when the user changes an existing vote", async () => {
    mockAwardXp.mockResolvedValue({
      xp: 55,
      level: 1,
      leveledUp: false,
      awarded: false,
    });
    const res = await callRoute({ vote: "down" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(REPORT_ID, VOTER, "down");
    expect(body.awarded).toBe(false);
  });
});
