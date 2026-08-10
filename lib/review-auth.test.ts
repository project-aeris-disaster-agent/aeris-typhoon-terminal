/** @jest-environment node */

import { authorizeReportReview } from "@/lib/review-auth";

jest.mock("@/lib/session-auth", () => ({
  getSessionAerisRole: jest.fn(),
}));
jest.mock("@/lib/auth-config", () => ({
  isDashboardAuthDisabled: jest.fn(),
}));

import { isDashboardAuthDisabled } from "@/lib/auth-config";
import { getSessionAerisRole } from "@/lib/session-auth";

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

  // Guards the constant-time comparison: a prefix match must not pass, and a
  // length mismatch must not throw. secretsMatch digests both sides first.
  it.each([
    ["a wrong secret of the same length", "secret-124"],
    ["a correct prefix", "secret-12"],
    ["a longer superstring", "secret-1234567890"],
    ["an empty string", ""],
  ])("rejects ai_agent presenting %s", async (_label, presented) => {
    process.env.INTERNAL_TRIAGE_SECRET = "secret-123";
    const auth = await authorizeReportReview(
      mockRequest({ "x-internal-triage-secret": presented }),
      "ai_agent",
    );
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.status).toBe(403);
  });

  it("rejects ai_agent when no internal secret is configured", async () => {
    const auth = await authorizeReportReview(
      mockRequest({ "x-internal-triage-secret": "anything" }),
      "ai_agent",
    );
    expect(auth.ok).toBe(false);
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
