/** Normalize Philippine mobile input to E.164 for Supabase/Twilio SMS. */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    digits = "+" + digits.slice(1).replace(/\D/g, "");
  } else {
    digits = digits.replace(/\D/g, "");
  }

  if (digits.startsWith("+")) {
    const national = digits.slice(1);
    if (national.startsWith("63") && national.length === 12) return `+${national}`;
    if (national.length >= 10 && national.length <= 15) return `+${national}`;
    return null;
  }

  if (digits.startsWith("63") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `+63${digits}`;

  return null;
}

export function isValidPhoneE164(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}
