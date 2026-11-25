import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { requestApiConfig } from "@/lib/request-api";
import {
  isReliefStoreConfigured,
  listActiveOperations,
  loadCounts,
  ReliefStoreError,
  toOperationView,
} from "@/lib/relief-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: active relief operations with their pickup sites and, when
 * REQUEST_API_KEY is set, live ReQuest pass counts. Any signed-in user
 * (middleware): counts only, no resident data.
 */
export async function GET(request: Request) {
  const limit = await rateLimit({
    key: `relief-ops:${getClientIp(request)}`,
    max: 60,
    windowSeconds: 60,
  });
  if (!limit.allowed) return jsonError("Too many requests.", 429);

  const configured = {
    store: isReliefStoreConfigured(),
    request: requestApiConfig() != null,
  };
  if (!configured.store) {
    return jsonOkNoStore({ configured, operations: [], fetchedAt: new Date().toISOString() });
  }

  try {
    const rows = await listActiveOperations();
    // Link-only mode (no REQUEST_API_KEY): don't call ReQuest at all; sites
    // carry no counts and no issue, just their event link.
    const counts = configured.request
      ? await loadCounts(rows.flatMap((r) => r.sites.map((s) => s.request_event_id)))
      : new Map();
    const operations = rows.map((r) => toOperationView(r.operation, r.sites, counts));
    return jsonOkNoStore({ configured, operations, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ReliefStoreError && err.missingTables) {
      return jsonOkNoStore({
        configured: { ...configured, store: false },
        operations: [],
        fetchedAt: new Date().toISOString(),
      });
    }
    if (err instanceof ReliefStoreError) return jsonError(err.message, err.status);
    console.error("[relief-ops] GET failed:", err);
    return jsonError("Could not load relief operations.", 500);
  }
}
