/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/review-auth", () => ({
  authorizeReportReview: jest.fn(),
}));

jest.mock("@/lib/onchain/mint-queue", () => ({
  countVerifiedPendingMint: jest.fn(),
  queueVerifiedReportsForMint: jest.fn(),
}));

jest.mock("@/services/onchain-mint-worker", () => ({
  mintQueuedReports: jest.fn(),
}));

jest.mock("@/lib/supabase-reports", () => ({
  supabaseServiceRoleEnabled: jest.fn(),
}));

import { authorizeReportReview } from "@/lib/review-auth";
import {
  countVerifiedPendingMint,
  queueVerifiedReportsForMint,
} from "@/lib/onchain/mint-queue";
import { mintQueuedReports } from "@/services/onchain-mint-worker";
import { supabaseServiceRoleEnabled } from "@/lib/supabase-reports";

const mockedAuth = authorizeReportReview as jest.MockedFunction<
  typeof authorizeReportReview
>;
const mockedCount = countVerifiedPendingMint as jest.MockedFunction<
  typeof countVerifiedPendingMint
>;
const mockedQueue = queueVerifiedReportsForMint as jest.MockedFunction<
  typeof queueVerifiedReportsForMint
>;
const mockedMint = mintQueuedReports as jest.MockedFunction<
  typeof mintQueuedReports
>;
const mockedServiceRole = supabaseServiceRoleEnabled as jest.MockedFunction<
  typeof supabaseServiceRoleEnabled
>;

function makeRequest() {
  return new NextRequest("http://localhost/api/reports/mint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

describe("/api/reports/mint", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedServiceRole.mockReturnValue(true);
    mockedAuth.mockResolvedValue({ ok: true, actorId: "admin-user" });
    mockedCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    mockedQueue.mockResolvedValue(2);
    let mintCalls = 0;
    mockedMint.mockImplementation(async () => {
      mintCalls += 1;
      if (mintCalls === 1) {
        return {
          attempted: 2,
          reachedDeadline: false,
          results: [
            { reportId: "a", status: "minted" },
            { reportId: "b", status: "minted" },
          ],
        };
      }
      return { attempted: 0, reachedDeadline: false, results: [] };
    });
  });

  it("requires admin authorization", async () => {
    mockedAuth.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "Admin role required for report review.",
    });
    const { POST } = await import("./route");
    const response = await POST(makeRequest());
    expect(response.status).toBe(403);
    expect(mockedQueue).not.toHaveBeenCalled();
  });

  it("queues verified reports and drains the mint worker", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockedQueue).toHaveBeenCalledTimes(1);
    expect(mockedMint).toHaveBeenCalledTimes(2);
    expect(body).toEqual(
      expect.objectContaining({
        pendingBefore: 2,
        newlyQueued: 2,
        attempted: 2,
        minted: 2,
        pendingAfter: 0,
      }),
    );
  });
});
