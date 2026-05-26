import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { isSpam, sanitizeText } from "@/lib/sanitize";
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

function readString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return sanitizeText(trimmed, max);
}

export async function POST(request: Request) {
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

  const disasterReportId = readString(body.disasterReportId, 80);
  let sessionId = readString(body.sessionId, 80);
  const operatorName = readString(body.operatorName, 80);
  let respondedToId = readString(body.respondedToId, 80);

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
            operatorName: operatorName ?? "AERIS Operator",
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
