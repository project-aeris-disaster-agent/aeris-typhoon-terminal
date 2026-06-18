/**
 * Resolve the current session's user id, with a stable dev fallback when
 * DASHBOARD_AUTH_DISABLED is set. Shared by user/profile API routes so the dev
 * identity matches community chat.
 */

import {
  getSessionUserId,
  isDashboardAuthDisabled,
} from "@/lib/supabase-server";

/** Stable pseudo-identity for local dev when dashboard auth is disabled. */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000d3b";

export async function resolveSessionUserId(): Promise<string | null> {
  const userId = await getSessionUserId().catch(() => null);
  if (userId) return userId;
  if (isDashboardAuthDisabled()) return DEV_USER_ID;
  return null;
}
