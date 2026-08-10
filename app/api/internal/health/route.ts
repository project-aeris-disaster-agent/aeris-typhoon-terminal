import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { authorizeInternalRequest } from "@/lib/internal-auth";
import { kvEnabled, store } from "@/lib/kv";
import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Deep health probe: does each dependency actually answer?
 *
 * `/api/health` checks only that environment variables are *present*, which is
 * what an uptime probe should do — it is public and hit constantly. But that
 * means a deploy with a revoked SUPABASE_SERVICE_ROLE_KEY reports `ok: true`
 * while every write fails, and nothing notices until an operator does.
 *
 * This route actually calls the dependencies, so it lives behind the operator
 * secret — same reasoning as /api/internal/minds/status: an unauthenticated
 * endpoint that makes outbound calls is a free amplification and, for the
 * metered services, free spend.
 *
 * Point a low-frequency monitor at this (every few minutes, not every few
 * seconds) with `Authorization: Bearer $INTERNAL_TRIAGE_SECRET`.
 */

type ProbeResult = {
  name: string;
  status: "ok" | "degraded" | "failed" | "skipped";
  latencyMs?: number;
  detail?: string;
};

const PROBE_TIMEOUT_MS = 5_000;

async function timed(
  name: string,
  fn: (signal: AbortSignal) => Promise<Omit<ProbeResult, "name" | "latencyMs">>,
): Promise<ProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const result = await fn(controller.signal);
    return { name, ...result, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name,
      status: "failed",
      detail: controller.signal.aborted ? `timeout after ${PROBE_TIMEOUT_MS}ms` : message,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads one row from a service-role-only table. This is the probe that matters
 * most: it proves the URL resolves, the key is valid, and the key still has
 * service_role — the three ways report writes silently stop working.
 */
async function probeSupabase(signal: AbortSignal) {
  const cfg = supabaseRestConfig();
  if (!cfg) {
    return {
      status: "failed" as const,
      detail: "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing",
    };
  }

  const res = await fetch(
    `${cfg.url}/rest/v1/aeris_user_profiles?select=user_id&limit=1`,
    { headers: serviceAuthHeaders(cfg.serviceKey), cache: "no-store", signal },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      status: "failed" as const,
      detail: `HTTP ${res.status} ${detail.slice(0, 160)}`,
    };
  }
  return { status: "ok" as const };
}

/** Round-trips a throwaway key so a wrong token surfaces as a failure. */
async function probeKv() {
  if (!kvEnabled) {
    return {
      status: "degraded" as const,
      detail:
        "KV not provisioned; rate limits are per-instance in-memory and upstream caches are not shared",
    };
  }
  const key = `health:probe:${crypto.randomUUID()}`;
  await store.set(key, "1", 30);
  const value = await store.get<string>(key);
  await store.del(key);
  return value === "1"
    ? { status: "ok" as const }
    : { status: "failed" as const, detail: "write/read round-trip did not match" };
}

/**
 * Reachability only — deliberately not a chat completion. Every LLM call is
 * metered, and a health check that spends tokens is a health check nobody runs
 * often enough to be useful. A connection means the host is up and DNS/TLS
 * work; it does not prove the /api/llm/chat contract still holds.
 */
async function probeAerisChat(signal: AbortSignal) {
  const baseUrl = process.env.AERIS_CHAT_API_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    return {
      status: "skipped" as const,
      detail: "AERIS_CHAT_API_BASE_URL is not set; agent chat and triage are disabled",
    };
  }

  const res = await fetch(baseUrl, { method: "HEAD", cache: "no-store", signal });
  // Any HTTP answer proves reachability; the root path's own status is not
  // this app's contract, so only a transport failure counts as failed.
  return {
    status: "ok" as const,
    detail: `reachable (HTTP ${res.status}); contract not verified`,
  };
}

export async function GET(request: Request) {
  if (!authorizeInternalRequest(request)) {
    return jsonError("Unauthorized.", 401);
  }

  const startedAt = Date.now();
  const probes = await Promise.all([
    timed("supabase", probeSupabase),
    timed("kv", probeKv),
    timed("aeris-chat", probeAerisChat),
  ]);

  // `degraded` and `skipped` are informational: KV absent or AERIS CHAT
  // unconfigured are documented, survivable states. Only a real failure to
  // reach a configured dependency flips ok.
  const failed = probes.filter((probe) => probe.status === "failed");
  const ok = failed.length === 0;

  return jsonOkNoStore(
    {
      ok,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      elapsedMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      failed: failed.map((probe) => probe.name),
      probes,
    },
    ok ? 200 : 503,
  );
}
