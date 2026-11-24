/**
 * Relief Ops v1 data access (server-only): operations and pickup sites in
 * Supabase, live pass counts from ReQuest. See
 * supabase/migrations/20261124100000_relief_operations.sql.
 */

import { serviceAuthHeaders, supabaseRestConfig } from "@/lib/supabase-rest";
import {
  classifyRequestError,
  getRequestPassCounts,
  type RequestCountsIssue,
  type RequestPassCounts,
} from "@/lib/request-api";

export type ReliefOperationRow = {
  id: string;
  name: string;
  lgu: string | null;
  incident_ref: string | null;
  status: "active" | "closed";
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
};

export type ReliefSiteRow = {
  id: string;
  operation_id: string;
  request_event_id: string;
  request_event_url: string;
  barangay: string;
  psgc_code: string | null;
  pickup_point: string | null;
  lat: number | null;
  lon: number | null;
  pickup_start: string | null;
  pickup_end: string | null;
  pack_description: string | null;
  created_by: string | null;
  created_at: string;
};

/** What the dashboard receives for one site: no resident data, counts only. */
export type ReliefSiteView = {
  id: string;
  requestEventId: string;
  requestEventUrl: string;
  barangay: string;
  psgcCode: string | null;
  pickupPoint: string | null;
  lat: number | null;
  lon: number | null;
  pickupStart: string | null;
  pickupEnd: string | null;
  pack: string | null;
  counts: RequestPassCounts | null;
  countsIssue: RequestCountsIssue | null;
};

export type ReliefOperationView = {
  id: string;
  name: string;
  lgu: string | null;
  incidentRef: string | null;
  status: "active" | "closed";
  createdAt: string;
  sites: ReliefSiteView[];
  totals: {
    issued: number;
    claimed: number;
    /** Sites whose counts loaded this refresh. */
    sitesReporting: number;
    sitesTotal: number;
  };
};

export class ReliefStoreError extends Error {
  readonly status: number;
  /** The relief tables don't exist yet (migration not applied). */
  readonly missingTables: boolean;
  constructor(message: string, status = 500, missingTables = false) {
    super(message);
    this.name = "ReliefStoreError";
    this.status = status;
    this.missingTables = missingTables;
  }
}

function cfgOrThrow() {
  const cfg = supabaseRestConfig();
  if (!cfg) throw new ReliefStoreError("Supabase is not configured.", 503);
  return cfg;
}

async function restRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<T> {
  const cfg = cfgOrThrow();
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: serviceAuthHeaders(cfg.serviceKey, {
      accept: "application/json",
      ...(init.prefer ? { prefer: init.prefer } : {}),
    }),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // PGRST205 = table not in the schema cache: the migration isn't applied.
    if (detail.includes("PGRST205")) {
      throw new ReliefStoreError("Relief tables are missing; apply the relief migration.", 503, true);
    }
    // PostgREST answers 409 for both; the Postgres code tells them apart.
    // 23503 = foreign key (operation gone), 23505 = unique (event linked twice).
    if (detail.includes("23503")) {
      throw new ReliefStoreError("Relief operation not found.", 404);
    }
    if (detail.includes("23505")) {
      throw new ReliefStoreError("That ReQuest event is already linked to this operation.", 409);
    }
    console.error(`[relief-ops] ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status}): ${detail.slice(0, 200)}`);
    throw new ReliefStoreError("Relief data store request failed.", 502);
  }
  return (await res.json()) as T;
}

export function isReliefStoreConfigured(): boolean {
  return supabaseRestConfig() != null;
}

export async function listActiveOperations(): Promise<
  { operation: ReliefOperationRow; sites: ReliefSiteRow[] }[]
> {
  const ops = await restRequest<ReliefOperationRow[]>(
    "relief_operations?status=eq.active&select=*&order=created_at.desc&limit=20",
  );
  if (ops.length === 0) return [];
  const ids = ops.map((o) => o.id).join(",");
  const sites = await restRequest<ReliefSiteRow[]>(
    `relief_sites?operation_id=in.(${ids})&select=*&order=barangay.asc&limit=500`,
  );
  return ops.map((operation) => ({
    operation,
    sites: sites.filter((s) => s.operation_id === operation.id),
  }));
}

export async function getOperation(id: string): Promise<ReliefOperationRow | null> {
  const rows = await restRequest<ReliefOperationRow[]>(
    `relief_operations?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
  );
  return rows[0] ?? null;
}

export async function insertOperation(input: {
  name: string;
  lgu: string | null;
  incidentRef: string | null;
  createdBy: string;
}): Promise<ReliefOperationRow> {
  const rows = await restRequest<ReliefOperationRow[]>("relief_operations", {
    method: "POST",
    prefer: "return=representation",
    body: {
      name: input.name,
      lgu: input.lgu,
      incident_ref: input.incidentRef,
      created_by: input.createdBy,
    },
  });
  const row = rows[0];
  if (!row) throw new ReliefStoreError("Relief operation insert returned no row.", 502);
  return row;
}

export async function closeOperation(id: string): Promise<ReliefOperationRow | null> {
  const rows = await restRequest<ReliefOperationRow[]>(
    `relief_operations?id=eq.${encodeURIComponent(id)}&status=eq.active`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: { status: "closed", closed_at: new Date().toISOString() },
    },
  );
  return rows[0] ?? null;
}

export async function insertSite(input: {
  operationId: string;
  requestEventId: string;
  requestEventUrl: string;
  barangay: string;
  psgcCode: string | null;
  pickupPoint: string | null;
  lat: number | null;
  lon: number | null;
  pickupStart: string | null;
  pickupEnd: string | null;
  pack: string | null;
  createdBy: string;
}): Promise<ReliefSiteRow> {
  const rows = await restRequest<ReliefSiteRow[]>("relief_sites", {
    method: "POST",
    prefer: "return=representation",
    body: {
      operation_id: input.operationId,
      request_event_id: input.requestEventId,
      request_event_url: input.requestEventUrl,
      barangay: input.barangay,
      psgc_code: input.psgcCode,
      pickup_point: input.pickupPoint,
      lat: input.lat,
      lon: input.lon,
      pickup_start: input.pickupStart,
      pickup_end: input.pickupEnd,
      pack_description: input.pack,
      created_by: input.createdBy,
    },
  });
  const row = rows[0];
  if (!row) throw new ReliefStoreError("Relief site insert returned no row.", 502);
  return row;
}

// ---- live counts ----------------------------------------------------------

/**
 * Counts per ReQuest event, cached per server instance. Vercel KV is not
 * provisioned in production, so this is the only shared cache: each instance
 * calls ReQuest at most once a minute per event.
 */
const COUNTS_TTL_MS = 60_000;
const ISSUE_TTL_MS = 15_000;
const MAX_PARALLEL = 6;

type CountsEntry = {
  at: number;
  counts: RequestPassCounts | null;
  issue: RequestCountsIssue | null;
};
const countsCache = new Map<string, CountsEntry>();

/** Test hook. */
export function resetReliefCountsCache(): void {
  countsCache.clear();
}

async function countsFor(eventId: string, now: number): Promise<CountsEntry> {
  const hit = countsCache.get(eventId);
  if (hit && now - hit.at < (hit.issue ? ISSUE_TTL_MS : COUNTS_TTL_MS)) return hit;
  let entry: CountsEntry;
  try {
    entry = { at: now, counts: await getRequestPassCounts(eventId), issue: null };
  } catch (err) {
    const issue = classifyRequestError(err);
    if (issue === "unavailable") {
      console.error(`[relief-ops] ReQuest counts failed for event ${eventId}:`, err);
    }
    // Keep the last good counts on a transient failure so the board doesn't blank.
    entry = { at: now, counts: issue === "unavailable" ? hit?.counts ?? null : null, issue };
  }
  countsCache.set(eventId, entry);
  return entry;
}

export async function loadCounts(
  eventIds: string[],
  now = Date.now(),
): Promise<Map<string, CountsEntry>> {
  const unique = [...new Set(eventIds)];
  const out = new Map<string, CountsEntry>();
  for (let i = 0; i < unique.length; i += MAX_PARALLEL) {
    const batch = unique.slice(i, i + MAX_PARALLEL);
    const results = await Promise.all(batch.map((id) => countsFor(id, now)));
    batch.forEach((id, j) => out.set(id, results[j]));
  }
  return out;
}

export function toOperationView(
  operation: ReliefOperationRow,
  sites: ReliefSiteRow[],
  counts: Map<string, CountsEntry>,
): ReliefOperationView {
  const views: ReliefSiteView[] = sites.map((s) => {
    const c = counts.get(s.request_event_id);
    return {
      id: s.id,
      requestEventId: s.request_event_id,
      requestEventUrl: s.request_event_url,
      barangay: s.barangay,
      psgcCode: s.psgc_code,
      pickupPoint: s.pickup_point,
      lat: s.lat,
      lon: s.lon,
      pickupStart: s.pickup_start,
      pickupEnd: s.pickup_end,
      pack: s.pack_description,
      counts: c?.counts ?? null,
      countsIssue: c?.issue ?? null,
    };
  });
  const reporting = views.filter((v) => v.counts);
  return {
    id: operation.id,
    name: operation.name,
    lgu: operation.lgu,
    incidentRef: operation.incident_ref,
    status: operation.status,
    createdAt: operation.created_at,
    sites: views,
    totals: {
      issued: reporting.reduce((a, v) => a + (v.counts?.issued ?? 0), 0),
      claimed: reporting.reduce((a, v) => a + (v.counts?.claimed ?? 0), 0),
      sitesReporting: reporting.length,
      sitesTotal: views.length,
    },
  };
}
