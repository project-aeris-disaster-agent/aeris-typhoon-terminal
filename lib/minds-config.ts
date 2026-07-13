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

/** Bounded wait for Mind replies on critical alerts (SOS/breaking). */
export function getMindsReplyTimeoutMs(): number {
  const raw = Number(process.env.MINDS_REPLY_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 300_000) return raw;
  // Default fits inside cron duration budgets (daily route caps at 60s total).
  return 20_000;
}

/**
 * Opt-in: ask the Mind to author a narrative assessment for AERIS Report
 * emails. Off by default — it spends cognition on every generated report.
 */
export function isMindsReportNarrativeEnabled(): boolean {
  const raw = process.env.MINDS_REPORT_NARRATIVE_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Cognition balance below this logs/returns a low-balance warning. */
export function getMindsCognitionWarnThreshold(): number {
  const raw = Number(process.env.MINDS_COGNITION_WARN_THRESHOLD);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 100;
}

export type AerisUserRole = "volunteer" | "responder" | "lgu";

/**
 * Role Minds: per-persona Mind IDs, each falling back to the shared
 * Watch Officer Mind until dedicated Minds are provisioned at hellominds.ai.
 */
export function getMindsRoleMindId(role: AerisUserRole): string | undefined {
  const envKey = {
    volunteer: "MINDS_VOLUNTEER_MIND_ID",
    responder: "MINDS_RESPONDER_MIND_ID",
    lgu: "MINDS_LGU_MIND_ID",
  }[role];
  const id = process.env[envKey]?.trim();
  return id && id.length > 0 ? id : getMindsAerisMindId();
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
