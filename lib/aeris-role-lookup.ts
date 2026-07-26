import { resolveAerisRole, type AerisRole, type AerisUserRoleRow } from "@/lib/aeris-roles";
import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";

/**
 * Service-role lookup for middleware / edge contexts without cookie-bound Supabase.
 *
 * Fails closed to `guest_viewer`, but never *silently*: a lookup that errors is
 * indistinguishable from "user has no role row" at the call site, and that
 * ambiguity previously hid a total loss of admin access in production. Any
 * non-2xx response is logged with the upstream body so a schema/permission
 * regression surfaces in logs instead of degrading everyone to guest.
 */
export async function lookupAerisRoleByUserId(userId: string): Promise<AerisRole> {
  const cfg = supabaseRestConfig();
  if (!cfg) {
    console.error("[aeris-roles] Supabase REST is unconfigured; defaulting to guest_viewer.");
    return "guest_viewer";
  }

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
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[aeris-roles] Role lookup failed (${res.status}) for user; defaulting to guest_viewer. ${detail.slice(0, 200)}`,
      );
      return "guest_viewer";
    }
    const rows = (await res.json()) as AerisUserRoleRow[];
    return resolveAerisRole(rows[0] ?? null);
  } catch (error) {
    console.error(
      `[aeris-roles] Role lookup threw; defaulting to guest_viewer. ${error instanceof Error ? error.message : String(error)}`,
    );
    return "guest_viewer";
  }
}
