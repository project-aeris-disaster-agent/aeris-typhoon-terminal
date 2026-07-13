import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { sanitizeText, isSafeUrl } from "@/lib/sanitize";
import { resolveSessionUserId } from "@/lib/session-user";
import { validateUsername } from "@/lib/username";
import {
  type EditableProfileFields,
  ensureUserProfile,
  getUserProfile,
  toClientProfile,
  updateUserProfile,
  userProfilesEnabled,
} from "@/lib/user-profiles";
import { touchUserLastActive } from "@/lib/storm-watch/recipients";
import { awardXp } from "@/lib/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SOCIALS = new Set([
  "twitter",
  "facebook",
  "instagram",
  "telegram",
  "discord",
  "website",
]);
const PHONE_PATTERN = /^[+0-9 ()-]{6,20}$/;

export async function GET() {
  if (!userProfilesEnabled()) {
    return jsonError("User profiles are not configured.", 503);
  }

  const userId = await resolveSessionUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  // Self-heal: create the row if a profile somehow does not exist yet.
  const profile =
    (await getUserProfile(userId)) ?? (await ensureUserProfile({ userId }));
  if (!profile) return jsonError("Failed to load profile.", 502);

  return jsonOkNoStore({ profile: toClientProfile(profile) });
}

export async function PATCH(request: Request) {
  if (!userProfilesEnabled()) {
    return jsonError("User profiles are not configured.", 503);
  }

  const userId = await resolveSessionUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  const limit = await rateLimit({
    key: `user-profile:${userId}`,
    max: 10,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return jsonError("Too many profile updates. Try again shortly.", 429, {
      resetSeconds: limit.resetSeconds,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  const fields: EditableProfileFields = {};

  if (record.username !== undefined) {
    const validation = validateUsername(String(record.username ?? ""));
    if (!validation.ok) return jsonError(validation.error, 400);
    fields.username = validation.value;
  }

  if (record.barangay !== undefined) {
    const value = sanitizeText(String(record.barangay ?? ""), 120);
    fields.barangay = value || null;
  }

  if (record.phone !== undefined) {
    const raw = String(record.phone ?? "").trim();
    if (raw && !PHONE_PATTERN.test(raw)) {
      return jsonError("Invalid phone number.", 400);
    }
    fields.phone = raw || null;
  }

  if (record.avatar_url !== undefined) {
    const raw = String(record.avatar_url ?? "").trim();
    if (raw && !isSafeUrl(raw)) {
      return jsonError("Invalid avatar URL.", 400);
    }
    fields.avatar_url = raw || null;
  }

  if (record.socials !== undefined) {
    const socials = sanitizeSocials(record.socials);
    if (socials === null) {
      return jsonError("Invalid social links.", 400);
    }
    fields.socials = socials;
  }

  if (record.storm_email_enabled !== undefined) {
    if (typeof record.storm_email_enabled !== "boolean") {
      return jsonError("storm_email_enabled must be a boolean.", 400);
    }
    fields.storm_email_enabled = record.storm_email_enabled;
  }

  if (record.aeris_reports_enabled !== undefined) {
    if (typeof record.aeris_reports_enabled !== "boolean") {
      return jsonError("aeris_reports_enabled must be a boolean.", 400);
    }
    fields.aeris_reports_enabled = record.aeris_reports_enabled;
  }

  if (Object.keys(fields).length === 0) {
    return jsonError("No editable fields provided.", 400);
  }

  const result = await updateUserProfile(userId, fields);
  if (!result.ok) {
    if (result.reason === "collision") {
      return jsonError("That username is already taken.", 409);
    }
    if (result.reason === "not_found") {
      return jsonError("Profile not found.", 404);
    }
    return jsonError("Failed to update profile.", 502);
  }

  if (fields.storm_email_enabled === true || fields.aeris_reports_enabled === true) {
    void touchUserLastActive(userId);
  }

  const togglesOnly = Object.keys(fields).every((key) =>
    ["storm_email_enabled", "aeris_reports_enabled"].includes(key),
  );

  if (!togglesOnly) {
    // Reward profile completion incrementally: each field filled in grants XP
    // once (more completed fields → more XP). Per-field dedupe keys keep every
    // award idempotent, and the full-profile bonus is granted when all are set.
    const p = result.profile;
    const hasSocials = Boolean(p.socials && Object.keys(p.socials).length > 0);
    const fieldAwards: Array<{ key: string; filled: boolean; points: number }> = [
      { key: "barangay", filled: Boolean(p.barangay), points: 10 },
      { key: "phone", filled: Boolean(p.phone), points: 10 },
      { key: "social", filled: hasSocials, points: 5 },
    ];
    for (const award of fieldAwards) {
      if (!award.filled) continue;
      await awardXp(userId, "profile_completed", {
        points: award.points,
        dedupeKey: `profile_field:${award.key}:${userId}`,
      });
    }
    if (fieldAwards.every((a) => a.filled)) {
      await awardXp(userId, "profile_completed", {
        dedupeKey: `profile_completed:${userId}`,
      });
    }
  }

  if (togglesOnly) {
    return jsonOkNoStore({ profile: toClientProfile(result.profile) });
  }

  const refreshed = (await getUserProfile(userId)) ?? result.profile;
  return jsonOkNoStore({ profile: toClientProfile(refreshed) });
}

function sanitizeSocials(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const platform = key.toLowerCase();
    if (!ALLOWED_SOCIALS.has(platform)) continue;
    const text = sanitizeText(String(raw ?? ""), 200);
    if (!text) continue;
    // A website entry must be a safe URL; handles are free-form text.
    if (platform === "website" && !isSafeUrl(text)) return null;
    out[platform] = text;
  }
  return out;
}
