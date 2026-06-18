/**
 * Random default username generator (adjective + noun + number), e.g.
 * "SwiftTyphoon4821". Validation mirrors community_chat nicks so usernames are
 * interchangeable across products.
 */

const ADJECTIVES = [
  "Swift", "Calm", "Bright", "Bold", "Keen", "Brave", "Steady", "Lucky",
  "Quiet", "Rapid", "Solar", "Lunar", "Coastal", "Highland", "Tidal", "Storm",
  "Iron", "Golden", "Silver", "Crimson", "Azure", "Verdant", "Nimble", "Vivid",
];

const NOUNS = [
  "Typhoon", "Falcon", "Carabao", "Tarsier", "Eagle", "Marlin", "Heron",
  "Monsoon", "Current", "Summit", "Harbor", "Beacon", "Ranger", "Sentinel",
  "Pilot", "Voyager", "Compass", "Lantern", "Mango", "Bamboo", "Coral",
  "Tamaraw", "Kalaw", "Maya",
];

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
// Letters, numbers, and common IRC-ish separators; no whitespace.
export const USERNAME_PATTERN = /^[A-Za-z0-9_\-.[\]]+$/;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a random default username. */
export function generateUsername(): string {
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${suffix}`;
}

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateUsername(raw: string): UsernameValidation {
  const value = raw.trim();
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return {
      ok: false,
      error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`,
    };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      error: "Username can only use letters, numbers, _ - . [ ]",
    };
  }
  return { ok: true, value };
}
