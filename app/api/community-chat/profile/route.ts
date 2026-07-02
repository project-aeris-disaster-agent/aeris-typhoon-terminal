import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { sanitizeText } from "@/lib/sanitize";
import {
  getSessionUserId,
  isDashboardAuthDisabled,
} from "@/lib/supabase-server";
import {
  communityChatEnabled,
  getChatProfile,
  upsertChatProfile,
} from "@/lib/community-chat";
import { getUserProfile } from "@/lib/user-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NICK_MIN = 2;
const NICK_MAX = 24;
// Letters, numbers, and common IRC-ish separators; no whitespace.
const NICK_PATTERN = /^[A-Za-z0-9_\-.[\]]+$/;

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

  const profile = await getChatProfile(userId);
  if (profile?.display_name) {
    return jsonOkNoStore({ displayName: profile.display_name });
  }

  // No chat-specific nickname yet: the account already has a persistent
  // username from the main profile sync (aeris_user_profiles, seeded at
  // login). Reuse it so chat identity comes from the Privy-linked profile
  // instead of forcing a manual "pick a nickname" prompt on every device.
  // The user can still change it later via the nickname gate/edit flow,
  // which upserts a chat-specific override into community_chat_profiles.
  const mainProfile = await getUserProfile(userId).catch(() => null);
  if (mainProfile?.username) {
    const seeded = await upsertChatProfile(userId, mainProfile.username);
    if (seeded.ok) {
      return jsonOkNoStore({ displayName: seeded.profile.display_name });
    }
    // Collision with another chat nickname: fall through to manual entry
    // rather than silently assigning a different name than the profile.
  }

  return jsonOkNoStore({ displayName: null });
}

export async function POST(request: Request) {
  if (!communityChatEnabled()) {
    return jsonError("Community chat is not configured.", 503);
  }

  const userId = await resolveUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  const limit = await rateLimit({
    key: `community-chat-nick:${userId}`,
    max: 5,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError("Too many nickname changes. Try again shortly.", 429, {
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

  const displayName = sanitizeText(String(record.displayName ?? ""), NICK_MAX);
  if (displayName.length < NICK_MIN || displayName.length > NICK_MAX) {
    return jsonError(
      `Nickname must be ${NICK_MIN}-${NICK_MAX} characters.`,
      400,
    );
  }
  if (!NICK_PATTERN.test(displayName)) {
    return jsonError(
      "Nickname can only use letters, numbers, _ - . [ ]",
      400,
    );
  }

  const result = await upsertChatProfile(userId, displayName);
  if (!result.ok) {
    if (result.reason === "collision") {
      return jsonError("That nickname is already taken.", 409);
    }
    return jsonError("Failed to save nickname.", 502);
  }

  return jsonOkNoStore({ displayName: result.profile.display_name });
}
