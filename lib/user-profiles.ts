/**
 * User profile data access (server-side only).
 *
 * Profiles are keyed by the Privy DID (TEXT). All reads/writes use the service
 * role via PostgREST, mirroring lib/community-chat.ts. The base table holds PII,
 * so it is never read from the browser directly.
 */

import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";
import { generateUsername } from "@/lib/username";

export type UserProfileRow = {
  user_id: string;
  email: string | null;
  username: string;
  proxy_wallet_address: string | null;
  wallet_chain: string;
  barangay: string | null;
  phone: string | null;
  socials: Record<string, string>;
  avatar_url: string | null;
  xp: number;
  level: number;
  storm_email_enabled?: boolean;
  last_active_at?: string | null;
  created_at: string;
  updated_at: string;
};

const PROFILE_COLUMNS =
  "user_id,email,username,proxy_wallet_address,wallet_chain,barangay,phone,socials,avatar_url,xp,level,storm_email_enabled,last_active_at,created_at,updated_at";

export function userProfilesEnabled(): boolean {
  return supabaseRestConfig() !== null;
}

export async function getUserProfile(
  userId: string,
): Promise<UserProfileRow | null> {
  const cfg = supabaseRestConfig();
  if (!cfg) return null;

  const url = new URL(`${cfg.url}/rest/v1/aeris_user_profiles`);
  url.searchParams.set("select", PROFILE_COLUMNS);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: serviceAuthHeaders(cfg.serviceKey),
    cache: "no-store",
  });
  if (!res.ok) return null;

  const rows = (await res.json()) as UserProfileRow[];
  return rows[0] ?? null;
}

async function insertProfile(
  cfg: { url: string; serviceKey: string },
  payload: Record<string, unknown>,
): Promise<{ status: number; row: UserProfileRow | null; detail: string }> {
  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_user_profiles?select=${PROFILE_COLUMNS}`,
    {
      method: "POST",
      headers: {
        ...serviceAuthHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );
  if (res.ok) {
    const rows = (await res.json()) as UserProfileRow[];
    return { status: res.status, row: rows[0] ?? null, detail: "" };
  }
  const detail = await res.text().catch(() => "");
  return { status: res.status, row: null, detail };
}

/**
 * Ensure a profile row exists for the Privy user. Creates one with a random
 * username on first sight, and backfills email / embedded wallet address when
 * those become available on a later login.
 */
export async function ensureUserProfile(args: {
  userId: string;
  email?: string | null;
  walletAddress?: string | null;
}): Promise<UserProfileRow | null> {
  const cfg = supabaseRestConfig();
  if (!cfg) return null;

  const existing = await getUserProfile(args.userId);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.email && args.email) patch.email = args.email;
    if (!existing.proxy_wallet_address && args.walletAddress) {
      patch.proxy_wallet_address = args.walletAddress;
    }
    if (Object.keys(patch).length === 0) return existing;

    patch.updated_at = new Date().toISOString();
    const updated = await patchProfile(cfg, args.userId, patch);
    return updated ?? existing;
  }

  // First sync: insert with a random username, retrying on nick collisions.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const payload: Record<string, unknown> = {
      user_id: args.userId,
      email: args.email ?? null,
      username: generateUsername(),
      proxy_wallet_address: args.walletAddress ?? null,
    };
    const result = await insertProfile(cfg, payload);
    if (result.row) return result.row;

    if (result.status === 409) {
      // user_id PK conflict means a concurrent sync already created it.
      if (
        result.detail.includes("aeris_user_profiles_pkey") ||
        result.detail.includes("user_id")
      ) {
        return getUserProfile(args.userId);
      }
      // Otherwise it's a username collision; loop generates a fresh one.
      continue;
    }

    console.error(
      `[user-profiles] insert failed ${result.status}: ${result.detail}`,
    );
    return null;
  }

  return getUserProfile(args.userId);
}

async function patchProfile(
  cfg: { url: string; serviceKey: string },
  userId: string,
  patch: Record<string, unknown>,
): Promise<UserProfileRow | null> {
  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_user_profiles?user_id=eq.${encodeURIComponent(
      userId,
    )}&select=${PROFILE_COLUMNS}`,
    {
      method: "PATCH",
      headers: {
        ...serviceAuthHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as UserProfileRow[];
  return rows[0] ?? null;
}

export type EditableProfileFields = {
  username?: string;
  barangay?: string | null;
  phone?: string | null;
  socials?: Record<string, string>;
  avatar_url?: string | null;
  storm_email_enabled?: boolean;
};

export type UpdateProfileResult =
  | { ok: true; profile: UserProfileRow }
  | { ok: false; reason: "collision" | "error" | "not_found" };

/** Update editable profile fields. Username uniqueness is enforced by the DB. */
export async function updateUserProfile(
  userId: string,
  fields: EditableProfileFields,
): Promise<UpdateProfileResult> {
  const cfg = supabaseRestConfig();
  if (!cfg) return { ok: false, reason: "error" };

  const patch: Record<string, unknown> = {};
  if (fields.username !== undefined) patch.username = fields.username;
  if (fields.barangay !== undefined) patch.barangay = fields.barangay;
  if (fields.phone !== undefined) patch.phone = fields.phone;
  if (fields.socials !== undefined) patch.socials = fields.socials;
  if (fields.avatar_url !== undefined) patch.avatar_url = fields.avatar_url;
  if (fields.storm_email_enabled !== undefined) {
    patch.storm_email_enabled = fields.storm_email_enabled;
  }

  if (Object.keys(patch).length === 0) {
    const current = await getUserProfile(userId);
    if (!current) return { ok: false, reason: "not_found" };
    return { ok: true, profile: current };
  }

  patch.updated_at = new Date().toISOString();

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_user_profiles?user_id=eq.${encodeURIComponent(
      userId,
    )}&select=${PROFILE_COLUMNS}`,
    {
      method: "PATCH",
      headers: {
        ...serviceAuthHeaders(cfg.serviceKey),
        prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  );

  if (res.status === 409) return { ok: false, reason: "collision" };
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (detail.includes("23505")) return { ok: false, reason: "collision" };
    console.error(`[user-profiles] update failed ${res.status}: ${detail}`);
    return { ok: false, reason: "error" };
  }

  const rows = (await res.json()) as UserProfileRow[];
  const profile = rows[0];
  if (!profile) return { ok: false, reason: "not_found" };
  return { ok: true, profile };
}

/** Profile shape returned to the owning client (no internal-only fields). */
export type ClientUserProfile = {
  userId: string;
  email: string | null;
  username: string;
  proxyWalletAddress: string | null;
  walletChain: string;
  barangay: string | null;
  phone: string | null;
  socials: Record<string, string>;
  avatarUrl: string | null;
  stormEmailEnabled: boolean;
  xp: number;
  level: number;
  createdAt: string;
  updatedAt: string;
};

export function toClientProfile(row: UserProfileRow): ClientUserProfile {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    proxyWalletAddress: row.proxy_wallet_address,
    walletChain: row.wallet_chain,
    barangay: row.barangay,
    phone: row.phone,
    socials: row.socials ?? {},
    avatarUrl: row.avatar_url,
    stormEmailEnabled: row.storm_email_enabled !== false,
    xp: row.xp,
    level: row.level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
