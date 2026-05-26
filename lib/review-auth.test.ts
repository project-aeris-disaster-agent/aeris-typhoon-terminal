/** @jest-environment node */

import { authorizeReportReview } from "@/lib/review-auth";

jest.mock("@/lib/supabase-server", () => ({
  getSessionAerisRole: jest.fn(),
  isDashboardAuthDisabled: jest.fn(),
}));

import { getSessionAerisRole, isDashboardAuthDisabled } from "@/lib/supabase-server";

function mockRequest(headers: Record<string, string> = {}) {
  return {
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? headers[key] ?? null,
    },
  } as unknown as import("next/server").NextRequest;
}

describe("authorizeReportReview", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.INTERNAL_TRIAGE_SECRET;
    (isDashboardAuthDisabled as jest.Mock).mockReturnValue(false);
  });

  it("allows ai_agent with internal triage secret", async () => {
    process.env.INTERNAL_TRIAGE_SECRET = "secret-123";
    const auth = await authorizeReportReview(
      mockRequest({ "x-internal-triage-secret": "secret-123" }),
      "ai_agent",
    );
    expect(auth.ok).toBe(true);
  });

  it("rejects ai_agent without internal secret", async () => {
    process.env.INTERNAL_TRIAGE_SECRET = "secret-123";
    const auth = await authorizeReportReview(mockRequest(), "ai_agent");
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(403);
  });

  it("allows human_operator when session role is admin", async () => {
    (getSessionAerisRole as jest.Mock).mockResolvedValue({
      userId: "user-1",
      role: "admin",
    });
    const auth = await authorizeReportReview(mockRequest(), "human_operator");
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.actorId).toBe("user-1");
  });

  it("rejects guest_viewer for human_operator", async () => {
    (getSessionAerisRole as jest.Mock).mockResolvedValue({
      userId: "user-2",
      role: "guest_viewer",
    });
    const auth = await authorizeReportReview(mockRequest(), "human_operator");
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(403);
  });

  it("allows human_operator when dashboard auth is disabled", async () => {
    (isDashboardAuthDisabled as jest.Mock).mockReturnValue(true);
    const auth = await authorizeReportReview(mockRequest(), "human_operator");
    expect(auth.ok).toBe(true);
  });
});
