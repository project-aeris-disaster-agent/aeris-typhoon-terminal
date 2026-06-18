import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { fetchPrivyUserInfo } from "@/lib/privy-users";
import { resolveSessionUserId, DEV_USER_ID } from "@/lib/session-user";
import {
  ensureUserProfile,
  toClientProfile,
  userProfilesEnabled,
} from "@/lib/user-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Idempotently create / refresh the Supabase profile for the signed-in Privy
 * user. Called right after login and as a safety-net on app load. Reads the
 * authoritative email + embedded wallet from Privy server-side.
 */
export async function POST() {
  if (!userProfilesEnabled()) {
    return jsonError("User profiles are not configured.", 503);
  }

  const userId = await resolveSessionUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  // Real Privy users have their email + embedded wallet fetched authoritatively;
  // the dev fallback identity has no Privy record.
  const privyInfo =
    userId === DEV_USER_ID ? null : await fetchPrivyUserInfo(userId);

  const profile = await ensureUserProfile({
    userId,
    email: privyInfo?.email ?? null,
    walletAddress: privyInfo?.walletAddress ?? null,
  });

  if (!profile) {
    return jsonError("Failed to sync user profile.", 502);
  }

  return jsonOkNoStore({ profile: toClientProfile(profile) });
}
