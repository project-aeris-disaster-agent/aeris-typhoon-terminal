/**
 * Single source of truth for "who is making this request".
 *
 * Previously split across three modules — this file, a set of re-export shims
 * in `supabase-server` (which used dynamic imports purely to dodge a circular
 * dependency), and `session-user` for the dev fallback. Callers imported from
 * whichever layer they happened to find, and `DEV_USER_ID` had drifted into
 * three separate definitions. Import session identity from here and nowhere
 * else.
 */

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { lookupAerisRoleByUserId } from "@/lib/aeris-role-lookup";
import type { AerisRole } from "@/lib/aeris-roles";
import { isDashboardAuthDisabled } from "@/lib/auth-config";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export type AuthProvider = "privy" | "supabase" | null;

export type SessionIdentity = {
  userId: string | null;
  provider: AuthProvider;
};

function readPrivyTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get("privy-token")?.value ?? null;
}

async function readPrivyTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("privy-token")?.value ?? null;
}

async function resolvePrivyIdentity(
  accessToken: string | null,
): Promise<SessionIdentity> {
  if (!accessToken) {
    return { userId: null, provider: null };
  }

  // Loaded on demand: `@privy-io/node` pulls in a sizeable JWT/JWKS stack, and
  // routes that never see a privy-token cookie should not pay for it at module
  // load. Node caches the module after the first request that needs it.
  const { verifyPrivyAccessToken } = await import("@/lib/privy-server");
  const verified = await verifyPrivyAccessToken(accessToken);
  if (!verified) {
    return { userId: null, provider: null };
  }

  return { userId: verified.userId, provider: "privy" };
}

async function resolveSupabaseIdentity(): Promise<SessionIdentity> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id ?? null;
    if (!userId) {
      return { userId: null, provider: null };
    }
    return { userId, provider: "supabase" };
  } catch {
    return { userId: null, provider: null };
  }
}

export async function getSessionIdentityFromRequest(
  request: NextRequest,
): Promise<SessionIdentity> {
  const privyIdentity = await resolvePrivyIdentity(
    readPrivyTokenFromRequest(request),
  );
  if (privyIdentity.userId) return privyIdentity;

  return resolveSupabaseIdentity();
}

export async function getSessionIdentity(): Promise<SessionIdentity> {
  const privyIdentity = await resolvePrivyIdentity(
    await readPrivyTokenFromCookies(),
  );
  if (privyIdentity.userId) return privyIdentity;

  return resolveSupabaseIdentity();
}

export async function getSessionUserId(): Promise<string | null> {
  const identity = await getSessionIdentity();
  return identity.userId;
}

export async function getSessionAerisRole(): Promise<{
  userId: string | null;
  role: AerisRole;
}> {
  const userId = await getSessionUserId();
  if (!userId) return { userId: null, role: "guest_viewer" };
  const role = await lookupAerisRoleByUserId(userId);
  return { userId, role };
}

/** Stable pseudo-identity for local dev when dashboard auth is disabled. */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000d3b";

/**
 * Session user id, falling back to a fixed dev identity when
 * `DASHBOARD_AUTH_DISABLED` is set so local dev has a consistent user across
 * reports, profile, and community chat.
 */
export async function resolveSessionUserId(): Promise<string | null> {
  const userId = await getSessionUserId().catch(() => null);
  if (userId) return userId;
  if (isDashboardAuthDisabled()) return DEV_USER_ID;
  return null;
}
