import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { resolveSessionUserId } from "@/lib/session-user";
import { awardXp } from "@/lib/gamification";
import { userProfilesEnabled } from "@/lib/user-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One usage award per 15-minute bucket of active dashboard time.
const BUCKET_MS = 15 * 60 * 1000;

/**
 * Usage-time heartbeat. The client pings this periodically while the dashboard
 * tab is active; XP is granted at most once per time bucket (idempotent via the
 * dedupe key), so refresh spam cannot farm points.
 */
export async function POST() {
  if (!userProfilesEnabled()) {
    return jsonError("User profiles are not configured.", 503);
  }

  const userId = await resolveSessionUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  const limit = await rateLimit({
    key: `user-activity:${userId}`,
    max: 6,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError("Too many activity pings.", 429, {
      resetSeconds: limit.resetSeconds,
    });
  }

  const bucket = Math.floor(Date.now() / BUCKET_MS);
  const result = await awardXp(userId, "usage_time", {
    dedupeKey: `usage:${userId}:${bucket}`,
  });

  return jsonOkNoStore({
    awarded: result?.awarded ?? false,
    xp: result?.xp ?? null,
    level: result?.level ?? null,
    leveledUp: result?.leveledUp ?? false,
  });
}
