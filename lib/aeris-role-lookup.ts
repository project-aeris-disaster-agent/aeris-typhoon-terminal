import { resolveAerisRole, type AerisRole, type AerisUserRoleRow } from "@/lib/aeris-roles";
import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";

/** Service-role lookup for middleware / edge contexts without cookie-bound Supabase. */
export async function lookupAerisRoleByUserId(userId: string): Promise<AerisRole> {
  const cfg = supabaseRestConfig();
  if (!cfg) return "guest_viewer";

  const url = new URL(`${cfg.url}/rest/v1/aeris_user_roles`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("select", "user_id,role");
  url.searchParams.set("limit", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        ...serviceAuthHeaders(cfg.serviceKey),
        accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return "guest_viewer";
    const rows = (await res.json()) as AerisUserRoleRow[];
    return resolveAerisRole(rows[0] ?? null);
  } catch {
    return "guest_viewer";
  }
}
