/**
 * Text and URL sanitization helpers for user-submitted content.
 *
 * For incident report descriptions we strip HTML, control characters, and
 * obvious spam patterns, then truncate. URLs are validated against an
 * allowlist of safe schemes.
 */

const BANNED_PATTERNS = [
  /viagra|cialis|casino|crypto\s*giveaway|forex\s*bot|\bloan\s*approved\b/i,
  /https?:\/\/\S*\.(ru|cn|tk|xyz)\b/i,
];

export function sanitizeText(raw: string, maxLen = 280): string {
  let s = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

export function isSpam(text: string): boolean {
  return BANNED_PATTERNS.some((p) => p.test(text));
}

export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
