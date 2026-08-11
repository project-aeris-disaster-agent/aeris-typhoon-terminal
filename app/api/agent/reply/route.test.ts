/** @jest-environment node */

jest.mock("@/lib/session-auth", () => ({
  getSessionAerisRole: jest.fn(),
}));
jest.mock("@/lib/supabase-agent", () => ({
  getLatestUrgentMessageForSession: jest.fn(),
  insertOperatorReplyAgentMessage: jest.fn(),
}));
jest.mock("@/lib/rate-limit", () => ({
  getClientIp: jest.fn(() => "1.2.3.4"),
  rateLimit: jest.fn(async () => ({
    allowed: true,
    remaining: 29,
    resetSeconds: 60,
  })),
}));

import { POST } from "./route";
import { getSessionAerisRole } from "@/lib/session-auth";
import {
  getLatestUrgentMessageForSession,
  insertOperatorReplyAgentMessage,
} from "@/lib/supabase-agent";

const mockRole = getSessionAerisRole as jest.Mock;
const mockInsert = insertOperatorReplyAgentMessage as jest.Mock;
const mockLatestUrgent = getLatestUrgentMessageForSession as jest.Mock;

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function callRoute(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return POST(
    new Request("http://localhost/api/agent/reply", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const VALID_BODY = {
  content: "Rescue team dispatched to your location.",
  sessionId: SESSION_ID,
  operatorName: "Naga City DRRMO",
};

describe("POST /api/agent/reply", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.INTERNAL_TRIAGE_SECRET;
    delete process.env.AERIS_CHAT_API_BASE_URL;
    mockInsert.mockResolvedValue({ id: "msg-1", content: VALID_BODY.content });
    mockLatestUrgent.mockResolvedValue(null);
  });

  // This route publishes a message into a citizen's chat attributed to a named
  // human operator. Middleware only proves *someone* is signed in, so without
  // a role check any guest_viewer could post "evacuation order lifted" through
  // a channel the recipient has every reason to trust.
  it("rejects an unauthenticated caller", async () => {
    mockRole.mockResolvedValue({ userId: null, role: "guest_viewer" });
    const res = await callRoute(VALID_BODY);
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a signed-in non-admin", async () => {
    mockRole.mockResolvedValue({ userId: "did:privy:rando", role: "guest_viewer" });
    const res = await callRoute(VALID_BODY);
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a volunteer", async () => {
    mockRole.mockResolvedValue({ userId: "did:privy:vol", role: "volunteer" });
    const res = await callRoute(VALID_BODY);
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("allows an admin session", async () => {
    mockRole.mockResolvedValue({ userId: "did:privy:admin", role: "admin" });
    const res = await callRoute(VALID_BODY);
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      VALID_BODY.content,
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
  });

  it("allows a server-to-server caller presenting the internal secret", async () => {
    process.env.INTERNAL_TRIAGE_SECRET = "operator-secret";
    const res = await callRoute(VALID_BODY, {
      authorization: "Bearer operator-secret",
    });
    expect(res.status).toBe(200);
    // The session is never consulted when the secret is valid.
    expect(mockRole).not.toHaveBeenCalled();
  });

  it("rejects a wrong internal secret rather than falling back to the session", async () => {
    process.env.INTERNAL_TRIAGE_SECRET = "operator-secret";
    mockRole.mockResolvedValue({ userId: "did:privy:rando", role: "guest_viewer" });
    const res = await callRoute(VALID_BODY, {
      authorization: "Bearer wrong-secret",
    });
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // session_id / disaster_report_id / responded_to_id are uuid columns and are
  // also used as PostgREST filter values; non-uuid input can only produce a
  // Postgres 400 downstream, so it is dropped before it gets there.
  it("drops a non-uuid sessionId instead of forwarding it", async () => {
    mockRole.mockResolvedValue({ userId: "did:privy:admin", role: "admin" });
    const res = await callRoute({
      ...VALID_BODY,
      sessionId: "not-a-uuid; drop table",
      disasterReportId: "also-not-a-uuid",
    });
    expect(res.status).toBe(200);
    expect(mockLatestUrgent).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      VALID_BODY.content,
      expect.objectContaining({ sessionId: undefined, disasterReportId: undefined }),
    );
  });
});
