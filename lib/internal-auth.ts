/**
 * Shared authorization for cron and internal (server-to-server) routes.
 *
 * This replaces seven near-identical `authorizeCron` / `authorizeInternal`
 * helpers that had drifted into five different accept-rules — some took the
 * Bearer header, some a custom header, some accepted `INTERNAL_TRIAGE_SECRET`
 * as a cron secret and some did not. Anything reachable with one operator
 * secret was already reachable with the other via `/api/cron/daily`, so the
 * unified rules below grant no new access; they just make the surface legible.
 *
 * Secrets are compared in constant time. Both sides are SHA-256'd first so the
 * comparison never throws on a length mismatch and never leaks the expected
 * secret's length through timing.
 *
 * Node runtime only — every consumer declares `runtime = "nodejs"`. Do not
 * import from middleware (Edge).
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string compare via fixed-length digests. */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * True when the request presents `secret` as either `Authorization: Bearer …`
 * or, when `headerName` is given, that custom header.
 */
export function requestPresentsSecret(
  request: Request,
  secret: string | undefined,
  headerName?: string,
): boolean {
  const trimmed = secret?.trim();
  if (!trimmed) return false;

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && secretsMatch(auth.slice(7), trimmed)) {
    return true;
  }

  if (headerName && secretsMatch(request.headers.get(headerName), trimmed)) {
    return true;
  }

  return false;
}

/**
 * Scheduled jobs. Accepts the platform cron secret, or the internal operator
 * secret for manual invocation.
 */
export function authorizeCronRequest(request: Request): boolean {
  if (requestPresentsSecret(request, process.env.CRON_SECRET)) return true;
  return authorizeInternalRequest(request);
}

/** Server-to-server calls (Supabase webhooks, AERIS CHAT, operator tooling). */
export function authorizeInternalRequest(request: Request): boolean {
  return requestPresentsSecret(
    request,
    process.env.INTERNAL_TRIAGE_SECRET,
    "x-internal-triage-secret",
  );
}
