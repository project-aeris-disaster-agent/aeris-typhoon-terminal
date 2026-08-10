import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { authorizeInternalRequest } from "@/lib/internal-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isSpam, sanitizeText } from "@/lib/sanitize";
import { getSessionAerisRole } from "@/lib/session-auth";
import {
  getLatestUrgentMessageForSession,
  insertOperatorReplyAgentMessage,
} from "@/lib/supabase-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReplyBody = {
  content?: unknown;
  disasterReportId?: unknown;
  sessionId?: unknown;
  operatorName?: unknown;
  respondedToId?: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return sanitizeText(trimmed, max);
}

/**
 * `session_id`, `disaster_report_id`, and `responded_to_id` are uuid columns
 * and are also used as PostgREST filter values. Anything non-uuid is dropped
 * rather than forwarded: it can only produce a Postgres 400 downstream, and
 * refusing it here keeps free-form text out of the query string.
 */
function readUuid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : undefined;
}

/**
 * This route publishes a message to a citizen's chat session attributed to a
 * named human operator (`source: "operator"`, `metadata.kind: "operator"`).
 * It previously had no authorization at all beyond the middleware session
 * check — and middleware checks only that *someone* is signed in, not who. Any
 * guest_viewer could therefore post "evacuation order lifted" under an
 * arbitrary operator name into any session id, through an authenticated
 * channel the recipient has every reason to trust.
 *
 * Accepts the same two principals as report review: the internal operator
 * secret for server-to-server callers, or an authenticated `admin` session.
 */
async function authorizeOperatorReply(
  request: Request,
): Promise<
  { ok: true; operatorId: string } | { ok: false; status: number; error: string }
> {
  if (authorizeInternalRequest(request)) {
    return { ok: true, operatorId: "aeris-internal" };
  }

  const session = await getSessionAerisRole();
  if (!session.userId) {
    return { ok: false, status: 401, error: "Authentication required." };
  }
  if (session.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Admin role required to post an operator reply.",
    };
  }

  return { ok: true, operatorId: session.userId };
}

export async function POST(request: Request) {
  const auth = await authorizeOperatorReply(request);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const limit = await rateLimit({
    key: `agent-reply:${getClientIp(request)}`,
    max: 30,
    windowSeconds: 60,
  });

  if (!limit.allowed) {
    return jsonError("Too many operator reply requests.", 429, {
      resetSeconds: limit.resetSeconds,
    });
  }

  let body: ReplyBody;
  try {
    body = (await request.json()) as ReplyBody;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const content = readString(body.content, 1600);
  if (!content) return jsonError("content is required", 400);
  if (isSpam(content)) return jsonError("Message rejected by content filter.", 400);

  const disasterReportId = readUuid(body.disasterReportId);
  const sessionId = readUuid(body.sessionId);
  const operatorName = readString(body.operatorName, 80);
  let respondedToId = readUuid(body.respondedToId);

  // If sessionId is provided but respondedToId is not, infer the most-recent
  // urgent broadcast for this session so the operator reply is properly
  // threaded.
  if (sessionId && !respondedToId) {
    const latest = await getLatestUrgentMessageForSession(sessionId);
    if (latest) {
      respondedToId = latest.id;
    }
  }

  const inserted = await insertOperatorReplyAgentMessage(content, {
    disasterReportId,
    sessionId,
    operatorName,
    respondedToId,
  });

  if (!inserted) {
    return jsonError("Failed to record operator reply.", 502);
  }

  // Back-channel into the chat thread, if we have a sessionId.
  let chatDelivered = false;
  let chatStatus: number | undefined;
  if (sessionId) {
    const chatBase = process.env.AERIS_CHAT_API_BASE_URL?.replace(/\/$/, "");
    const secret = process.env.INTERNAL_TRIAGE_SECRET;
    if (chatBase) {
      const res = await fetch(`${chatBase}/api/chat/system-message`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify({
          sessionId,
          role: "assistant",
          content,
          metadata: {
            kind: "operator",
            // Display name is operator-chosen; operatorId is the authenticated
            // principal, so a reply can always be traced to the account that
            // sent it rather than the label it chose to wear.
            operatorName: operatorName ?? "AERIS Operator",
            operatorId: auth.operatorId,
            source: "aeris-dashboard",
            disasterReportId,
            agentMessageId: inserted.id,
          },
        }),
      }).catch(() => null);
      chatStatus = res?.status;
      chatDelivered = Boolean(res && res.ok);
    }
  }

  return jsonOkNoStore({
    message: inserted,
    chatDelivered,
    chatStatus,
  });
}
