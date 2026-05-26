import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  resolveAerisRole,
  type AerisRole,
  type AerisUserRoleRow,
} from "@/lib/aeris-roles";

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
  }

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component without mutable cookies.
        }
      },
    },
  });
}

export async function getSessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function lookupAerisRoleForUser(userId: string): Promise<AerisRole> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("aeris_user_roles")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  return resolveAerisRole(data as AerisUserRoleRow | null);
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

export function isDashboardAuthDisabled() {
  return process.env.DASHBOARD_AUTH_DISABLED === "true";
}
