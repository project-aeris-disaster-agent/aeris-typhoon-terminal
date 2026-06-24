import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";
import type { StormEmailRecipient } from "@/lib/storm-watch/types";

const PROFILE_COLUMNS =
  "user_id,email,username,storm_email_enabled,last_active_at";

export function parseActiveDays(): number {
  const raw = Number(process.env.STORM_EMAIL_ACTIVE_DAYS ?? "7");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
}

export async function listStormEmailRecipients(): Promise<StormEmailRecipient[]> {
  const cfg = supabaseRestConfig();
  if (!cfg) return [];

  const activeDays = parseActiveDays();
  const cutoff = new Date(Date.now() - activeDays * 24 * 60 * 60 * 1000).toISOString();

  const url = new URL(`${cfg.url}/rest/v1/aeris_user_profiles`);
  url.searchParams.set("select", PROFILE_COLUMNS);
  url.searchParams.set("storm_email_enabled", "eq.true");
  url.searchParams.set("email", "not.is.null");
  url.searchParams.set("last_active_at", `gte.${cutoff}`);
  url.searchParams.set("order", "last_active_at.desc");

  const res = await fetch(url.toString(), {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[storm-watch] recipient query failed: ${res.status}`);
    return [];
  }

  const rows = (await res.json()) as Array<{
    user_id: string;
    email: string | null;
    username: string;
  }>;

  const seen = new Set<string>();
  const recipients: StormEmailRecipient[] = [];
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push({
      userId: row.user_id,
      email,
      username: row.username,
    });
  }

  return recipients;
}

export async function touchUserLastActive(userId: string): Promise<void> {
  const cfg = supabaseRestConfig();
  if (!cfg) return;

  const now = new Date().toISOString();
  await fetch(
    `${cfg.url}/rest/v1/aeris_user_profiles?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        ...serviceAuthHeaders(cfg.serviceKey),
        prefer: "return=minimal",
      },
      body: JSON.stringify({ last_active_at: now, updated_at: now }),
    },
  ).catch(() => undefined);
}
