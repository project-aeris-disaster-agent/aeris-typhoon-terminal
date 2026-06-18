/**
 * Shared Supabase PostgREST config + headers for service-role data access.
 *
 * Server-side only: never import where the SUPABASE_SERVICE_ROLE_KEY could be
 * shipped to the browser. Mirrors the inline pattern in lib/community-chat.ts.
 */

export type SupabaseRestConfig = { url: string; serviceKey: string };

export function supabaseRestConfig(): SupabaseRestConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/$/, ""), serviceKey };
}

export function serviceAuthHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}
