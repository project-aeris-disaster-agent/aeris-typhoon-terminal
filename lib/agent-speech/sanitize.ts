const MAX_SPEECH_CHARS = 500;

const PLACEHOLDER_PATTERNS = [
  /^analyzing dashboard context\.{0,3}$/i,
];

/**
 * Strip markdown and cap length for TTS input.
 */
export function sanitizeForSpeech(text: string, maxChars = MAX_SPEECH_CHARS): string {
  let out = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars - 3)}...`;
  }
  return out;
}

export function isPlaceholderSpeechContent(content: string): boolean {
  const trimmed = content.trim();
  return PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed));
}
