import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";
import type {
  StormEmailEventType,
  StormWatchCycleRow,
  StormWatchMetaRow,
} from "@/lib/storm-watch/types";

function cfgOrNull() {
  return supabaseRestConfig();
}

export async function listStormWatchCycles(): Promise<StormWatchCycleRow[]> {
  const cfg = cfgOrNull();
  if (!cfg) return [];

  const url = new URL(`${cfg.url}/rest/v1/aeris_storm_watch_cycles`);
  url.searchParams.set("select", "*");

  const res = await fetch(url.toString(), {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return [];
  return (await res.json()) as StormWatchCycleRow[];
}

export async function upsertStormWatchCycle(
  row: StormWatchCycleRow,
): Promise<boolean> {
  const cfg = cfgOrNull();
  if (!cfg) return false;

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_storm_watch_cycles?on_conflict=cyclone_slug`,
    {
      method: "POST",
      headers: {
        ...serviceAuthHeaders(cfg.serviceKey),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    },
  );
  return res.ok;
}

export async function getStormWatchMeta(): Promise<StormWatchMetaRow | null> {
  const cfg = cfgOrNull();
  if (!cfg) return null;

  const url = new URL(`${cfg.url}/rest/v1/aeris_storm_watch_meta`);
  url.searchParams.set("select", "*");
  url.searchParams.set("id", "eq.1");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as StormWatchMetaRow[];
  return rows[0] ?? null;
}

export async function patchStormWatchMeta(
  patch: Partial<Pick<StormWatchMetaRow, "last_polled_at" | "last_bulletin_signature">>,
): Promise<boolean> {
  const cfg = cfgOrNull();
  if (!cfg) return false;

  const res = await fetch(`${cfg.url}/rest/v1/aeris_storm_watch_meta?id=eq.1`, {
    method: "PATCH",
    headers: {
      ...serviceAuthHeaders(cfg.serviceKey),
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

export async function hasStormEmailBeenSent(
  cycloneSlug: string,
  bulletinNumber: number,
  userId: string,
): Promise<boolean> {
  const cfg = cfgOrNull();
  if (!cfg) return false;

  const url = new URL(`${cfg.url}/rest/v1/aeris_storm_email_log`);
  url.searchParams.set("select", "id");
  url.searchParams.set("cyclone_slug", `eq.${cycloneSlug}`);
  url.searchParams.set("bulletin_number", `eq.${bulletinNumber}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const rows = (await res.json()) as { id: string }[];
  return rows.length > 0;
}

export async function logStormEmailSent(input: {
  cycloneSlug: string;
  bulletinNumber: number;
  eventType: StormEmailEventType;
  userId: string;
  recipientEmail: string;
  mindsFingerprint?: string;
}): Promise<boolean> {
  const cfg = cfgOrNull();
  if (!cfg) return false;

  const res = await fetch(`${cfg.url}/rest/v1/aeris_storm_email_log`, {
    method: "POST",
    headers: {
      ...serviceAuthHeaders(cfg.serviceKey),
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      cyclone_slug: input.cycloneSlug,
      bulletin_number: input.bulletinNumber,
      event_type: input.eventType,
      user_id: input.userId,
      recipient_email: input.recipientEmail,
      minds_fingerprint: input.mindsFingerprint ?? null,
    }),
  });

  return res.ok || res.status === 409;
}

export function stormWatchStateEnabled(): boolean {
  return cfgOrNull() !== null;
}
