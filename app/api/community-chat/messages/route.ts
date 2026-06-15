import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { sanitizeText, isSpam } from "@/lib/sanitize";
import {
  getSessionUserId,
  isDashboardAuthDisabled,
} from "@/lib/supabase-server";
import {
  COMMUNITY_CHAT_ROOM,
  communityChatEnabled,
  getChatProfile,
  insertChatMessage,
  listChatMessages,
} from "@/lib/community-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_LEN = 280;

/** Stable pseudo-identity for local dev when dashboard auth is disabled. */
const DEV_USER_ID = "00000000-0000-4000-8000-000000000d3b";

async function resolveUserId(): Promise<string | null> {
  const userId = await getSessionUserId().catch(() => null);
  if (userId) return userId;
  if (isDashboardAuthDisabled()) return DEV_USER_ID;
  return null;
}

export async function GET() {
  if (!communityChatEnabled()) {
    return jsonError("Community chat is not configured.", 503);
  }
  const userId = await resolveUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  const messages = await listChatMessages(COMMUNITY_CHAT_ROOM, 100);
  return jsonOkNoStore({ messages });
}

export async function POST(request: Request) {
  if (!communityChatEnabled()) {
    return jsonError("Community chat is not configured.", 503);
  }

  const userId = await resolveUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  const limit = await rateLimit({
    key: `community-chat:${userId}`,
    max: 10,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError("You're sending messages too quickly.", 429, {
      resetSeconds: limit.resetSeconds,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const body = sanitizeText(String(record.body ?? ""), MAX_BODY_LEN);
  if (body.length < 1) return jsonError("Message is empty.", 400);
  if (isSpam(body)) return jsonError("Message rejected by content filter.", 400);

  const profile = await getChatProfile(userId);
  if (!profile) {
    return jsonError("Set a nickname before chatting.", 403, {
      code: "nick_required",
    });
  }

  const clientId =
    typeof record.clientMessageId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      record.clientMessageId,
    )
      ? record.clientMessageId
      : undefined;

  const message = await insertChatMessage({
    userId,
    displayName: profile.display_name,
    body,
    id: clientId,
  });

  if (!message) return jsonError("Failed to send message.", 502);

  return jsonOkNoStore({ message }, 201);
}
