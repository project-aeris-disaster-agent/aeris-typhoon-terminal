/** Shared Minds integration env helpers (server-only). */

export function isMindsNotifyEnabled(): boolean {
  const raw = process.env.MINDS_NOTIFY_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function getMindsWatchAlias(): string {
  const alias = process.env.MINDS_WATCH_ALIAS?.trim();
  return alias && alias.length > 0 ? alias : "aeris-watch";
}

export function getMindsAerisMindId(): string | undefined {
  const id = process.env.MINDS_AERIS_MIND_ID?.trim();
  return id && id.length > 0 ? id : undefined;
}

export function getMindsBuilderApiKey(): string | undefined {
  const key = process.env.MINDS_BUILDER_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function getMindsApiSecret(): string | undefined {
  const secret = process.env.MINDS_API_SECRET?.trim();
  return secret && secret.length > 0 ? secret : undefined;
}

export function getDashboardPublicUrl(): string {
  const internal = process.env.AERIS_INTERNAL_BASE_URL?.replace(/\/$/, "");
  if (internal) return internal;
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (site) return site;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
