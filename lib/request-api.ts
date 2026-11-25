/**
 * Server-only client for the ReQuest Partner API (v1, read-only).
 *
 * ReQuest is the ticketing layer for relief releases: one ReQuest event per
 * pickup point and time window, one pass (ticket) per pre-registered
 * household, scanned once on relief day. AERIS only reads pass counts here.
 *
 *   REQUEST_API_KEY       partner key, `rq_test_...` or `rq_live_...` (required)
 *   REQUEST_API_BASE_URL  defaults to the production `/v1` base
 *
 * The key must NOT hold the `attendees:pii` scope: AERIS shows counts only and
 * nothing here reads names or emails.
 *
 * Never import from client components — the key would ship to the browser.
 */

export const DEFAULT_REQUEST_API_BASE_URL =
  "https://requestprod-6gasihacrq-uc.a.run.app/v1";

const TIMEOUT_MS = 8_000;

/** ReQuest event ids look like Firestore document ids (e.g. `0s1Q73YjSj0qH7`). */
export const REQUEST_EVENT_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export type RequestApiConfig = { baseUrl: string; apiKey: string };

export function requestApiConfig(): RequestApiConfig | null {
  const apiKey = process.env.REQUEST_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.REQUEST_API_BASE_URL?.trim() || DEFAULT_REQUEST_API_BASE_URL).replace(
    /\/$/,
    "",
  );
  return { baseUrl, apiKey };
}

/**
 * An upstream failure, carrying ReQuest's own error envelope:
 * `{ error: { code, message, http_status, retryable, request_id } }`.
 */
export class RequestApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    retryable?: boolean;
    requestId?: string;
  }) {
    super(opts.message);
    this.name = "RequestApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.requestId = opts.requestId;
  }
}

/** Why a site has no counts, in words the panel can show. */
export type RequestCountsIssue =
  | "not_configured"
  | "not_found"
  | "not_allowlisted"
  | "auth"
  | "unavailable";

export function classifyRequestError(err: unknown): RequestCountsIssue {
  if (!(err instanceof RequestApiError)) return "unavailable";
  if (err.code === "NOT_CONFIGURED") return "not_configured";
  if (err.status === 404) return "not_found";
  if (err.status === 403) return "not_allowlisted";
  if (err.status === 401) return "auth";
  return "unavailable";
}

/**
 * Pull the event id out of what an admin pastes: a bare id, or a ReQuest event
 * page link. For a link, a `?event=` / `?id=` / `?event_id=` query wins; else
 * the last path segment that looks like an id.
 */
export function parseRequestEventId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (REQUEST_EVENT_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  for (const key of ["event_id", "event", "id"]) {
    const v = url.searchParams.get(key)?.trim();
    if (v && REQUEST_EVENT_ID_RE.test(v)) return v;
  }
  const segments = url.pathname.split("/").filter(Boolean).reverse();
  for (const seg of segments) {
    const decoded = safeDecode(seg);
    if (REQUEST_EVENT_ID_RE.test(decoded) && !GENERIC_SEGMENTS.has(decoded.toLowerCase())) {
      return decoded;
    }
  }
  return null;
}

const GENERIC_SEGMENTS = new Set(["events", "event", "tickets", "checkout", "details"]);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

async function requestJson(
  path: string,
  params?: Record<string, string>,
): Promise<unknown> {
  const cfg = requestApiConfig();
  if (!cfg) {
    throw new RequestApiError({
      status: 503,
      code: "NOT_CONFIGURED",
      message: "REQUEST_API_KEY is not set.",
    });
  }

  const url = new URL(`${cfg.baseUrl}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new RequestApiError({
      status: 504,
      code: "UPSTREAM_UNREACHABLE",
      message: err instanceof Error ? err.message : "ReQuest is unreachable.",
      retryable: true,
    });
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const envelope = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new RequestApiError({
      status: res.status,
      code: typeof envelope.code === "string" ? envelope.code : `HTTP_${res.status}`,
      message:
        typeof envelope.message === "string" ? envelope.message : `ReQuest returned ${res.status}.`,
      retryable: envelope.retryable === true || res.status >= 500,
      requestId: typeof envelope.request_id === "string" ? envelope.request_id : undefined,
    });
  }
  return body;
}

export type RequestEventSummary = { id: string; title: string | null };

/** GET /events/{id}: proves the event exists and the key may read it. */
export async function getRequestEvent(eventId: string): Promise<RequestEventSummary> {
  const body = await requestJson(`/events/${encodeURIComponent(eventId)}`, { format: "json" });
  const event = isRecord(body) && isRecord(body.event) ? body.event : body;
  const title = isRecord(event)
    ? firstString(event, ["title", "name", "event_name"])
    : null;
  return { id: eventId, title };
}

export type RequestPassCounts = {
  /** Active passes issued for the event (households expected). */
  issued: number;
  /** Passes scanned at the pickup point (relief released). */
  claimed: number;
};

/**
 * Pass counts for one event, from GET /events/{id}/attendees.
 *
 * The docs promise "attendee list and totals" without naming the fields, so
 * the totals are read through {@link readAttendeeTotals}. If the first
 * response carries no checked-in figure, a second `checked_in=true` call
 * counts the scanned passes. `limit=1` keeps both calls light: AERIS never
 * reads the attendee rows themselves.
 */
export async function getRequestPassCounts(eventId: string): Promise<RequestPassCounts> {
  const path = `/events/${encodeURIComponent(eventId)}/attendees`;
  const all = readAttendeeTotals(await requestJson(path, { status: "ACTIVE", limit: "1" }));
  if (all.total == null) {
    throw new RequestApiError({
      status: 502,
      code: "UNRECOGNIZED_SHAPE",
      message: "ReQuest attendees response has no recognizable total.",
    });
  }

  let claimed = all.checkedIn;
  if (claimed == null) {
    const scanned = readAttendeeTotals(
      await requestJson(path, { status: "ACTIVE", checked_in: "true", limit: "1" }),
    );
    claimed = scanned.total;
  }
  if (claimed == null) {
    throw new RequestApiError({
      status: 502,
      code: "UNRECOGNIZED_SHAPE",
      message: "ReQuest attendees response has no recognizable checked-in count.",
    });
  }

  return { issued: all.total, claimed: Math.min(claimed, all.total) };
}

const TOTAL_KEYS = ["total", "total_attendees", "attendees", "total_count", "count", "active"];
const TOP_LEVEL_TOTAL_KEYS = ["total", "total_count", "total_attendees"];
const CHECKED_IN_KEYS =["checked_in", "checked_in_count", "checkedIn", "scanned", "total_checked_in"];

/**
 * Read the total and checked-in counts from an attendees response. Looks in
 * `totals`, `summary`, `counts` and `meta` before the top level, and accepts
 * the common spellings. Unconfirmed against a live key — see the tests for
 * the shapes covered.
 */
export function readAttendeeTotals(body: unknown): {
  total: number | null;
  checkedIn: number | null;
} {
  if (!isRecord(body)) return { total: null, checkedIn: null };
  const nested = [body.totals, body.summary, body.counts, body.meta].filter(isRecord);
  let total: number | null = null;
  let checkedIn: number | null = null;
  for (const scope of nested) {
    total ??= firstCount(scope, TOTAL_KEYS);
    checkedIn ??= firstCount(scope, CHECKED_IN_KEYS);
  }
  // At the top level a bare `count` is usually the page size (1 here), not
  // the event total, so only explicit total spellings count.
  total ??= firstCount(body, TOP_LEVEL_TOTAL_KEYS);
  checkedIn ??= firstCount(body, CHECKED_IN_KEYS);
  return { total, checkedIn };
}

function firstCount(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
    // `{ checked_in: { total: 12 } }` style nesting.
    if (isRecord(v) && typeof v.total === "number" && Number.isFinite(v.total) && v.total >= 0) {
      return Math.floor(v.total);
    }
  }
  return null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
