import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { AerisRole } from "@/lib/aeris-roles";
import { verifyPrivyAccessToken } from "@/lib/privy-server";
import {
  createSupabaseServerClient,
  lookupAerisRoleForUser,
} from "@/lib/supabase-server";

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
  const role = await lookupAerisRoleForUser(userId);
  return { userId, role };
}
