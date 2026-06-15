/**
 * Community Chat data access (server-side only).
 *
 * All writes go through the service role after the API route has
 * authenticated, sanitized, and rate-limited the request. Clients read
 * history through the API and receive live INSERTs via Supabase Realtime.
 */

export const COMMUNITY_CHAT_ROOM = "global";

export type ChatMessageRow = {
  id: string;
  room: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
};

export type ChatProfileRow = {
  user_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

const MESSAGE_COLUMNS = "id,room,user_id,display_name,body,created_at";
const PROFILE_COLUMNS = "user_id,display_name,created_at,updated_at";

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

export function communityChatEnabled(): boolean {
  return supabaseConfig() !== null;
}

function authHeaders(key: string) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

export async function listChatMessages(
  room = COMMUNITY_CHAT_ROOM,
  limit = 100,
): Promise<ChatMessageRow[]> {
  const cfg = supabaseConfig();
  if (!cfg) return [];

  const url = new URL(`${cfg.url}/rest/v1/community_chat_messages`);
  url.searchParams.set("select", MESSAGE_COLUMNS);
  url.searchParams.set("room", `eq.${room}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(Math.min(limit, 200)));

  const res = await fetch(url.toString(), {
    headers: authHeaders(cfg.serviceKey),
    cache: "no-store",
  });

  if (!res.ok) return [];

  const rows = (await res.json()) as ChatMessageRow[];
  return rows.reverse();
}

export async function insertChatMessage(args: {
  room?: string;
  userId: string;
  displayName: string;
  body: string;
  /** Optional caller-supplied UUID for optimistic-UI reconciliation. */
  id?: string;
}): Promise<ChatMessageRow | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;

  const payload: Record<string, unknown> = {
    room: args.room ?? COMMUNITY_CHAT_ROOM,
    user_id: args.userId,
    display_name: args.displayName,
    body: args.body,
  };
  if (args.id) payload.id = args.id;

  const res = await fetch(
    `${cfg.url}/rest/v1/community_chat_messages?select=${MESSAGE_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) return null;

  const rows = (await res.json()) as ChatMessageRow[];
  return rows[0] ?? null;
}

export async function getChatProfile(
  userId: string,
): Promise<ChatProfileRow | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;

  const url = new URL(`${cfg.url}/rest/v1/community_chat_profiles`);
  url.searchParams.set("select", PROFILE_COLUMNS);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: authHeaders(cfg.serviceKey),
    cache: "no-store",
  });

  if (!res.ok) return null;

  const rows = (await res.json()) as ChatProfileRow[];
  return rows[0] ?? null;
}

export type UpsertProfileResult =
  | { ok: true; profile: ChatProfileRow }
  | { ok: false; reason: "collision" | "error" };

export async function upsertChatProfile(
  userId: string,
  displayName: string,
): Promise<UpsertProfileResult> {
  const cfg = supabaseConfig();
  if (!cfg) return { ok: false, reason: "error" };

  const res = await fetch(
    `${cfg.url}/rest/v1/community_chat_profiles?select=${PROFILE_COLUMNS}&on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        ...authHeaders(cfg.serviceKey),
        prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify({
        user_id: userId,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (res.status === 409) return { ok: false, reason: "collision" };
  if (!res.ok) {
    // PostgREST reports unique-index violations as 409, but be defensive:
    // a 23505 in the body also means the nick is taken.
    const detail = await res.text().catch(() => "");
    if (detail.includes("23505")) return { ok: false, reason: "collision" };
    console.error(
      `[community-chat] profile upsert failed ${res.status}: ${detail}`,
    );
    return { ok: false, reason: "error" };
  }

  const rows = (await res.json()) as ChatProfileRow[];
  const profile = rows[0];
  if (!profile) return { ok: false, reason: "error" };
  return { ok: true, profile };
}
