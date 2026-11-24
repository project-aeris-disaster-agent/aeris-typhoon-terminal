import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { requestApiConfig } from "@/lib/request-api";
import {
  closeOperation,
  insertOperation,
  isReliefStoreConfigured,
  listActiveOperations,
  loadCounts,
  ReliefStoreError,
  toOperationView,
} from "@/lib/relief-ops";
import {
  authorizeReliefAdmin,
  InputError,
  optionalText,
  readJsonBody,
  requiredText,
  UUID_RE,
} from "@/lib/relief-ops-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: active relief operations with their pickup sites and live ReQuest pass
 * counts. Any signed-in user (middleware): counts only, no resident data.
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
    const counts = await loadCounts(
      rows.flatMap((r) => r.sites.map((s) => s.request_event_id)),
    );
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

/** POST (admin): start a relief operation. */
export async function POST(request: Request) {
  const auth = await authorizeReliefAdmin();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  try {
    const body = await readJsonBody(request);
    const operation = await insertOperation({
      name: requiredText(body.name, "Operation name", 3, 120),
      lgu: optionalText(body.lgu, 120),
      incidentRef: optionalText(body.incidentRef, 120),
      createdBy: auth.userId,
    });
    return jsonOkNoStore({ operation }, 201);
  } catch (err) {
    if (err instanceof InputError) return jsonError(err.message, 400);
    if (err instanceof ReliefStoreError) return jsonError(err.message, err.status);
    console.error("[relief-ops] POST failed:", err);
    return jsonError("Could not start the relief operation.", 500);
  }
}

/** PATCH (admin): `{ id, status: "closed" }` ends an operation. */
export async function PATCH(request: Request) {
  const auth = await authorizeReliefAdmin();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  try {
    const body = await readJsonBody(request);
    if (typeof body.id !== "string" || !UUID_RE.test(body.id)) {
      throw new InputError("A valid operation id is required.");
    }
    if (body.status !== "closed") throw new InputError('Only status "closed" is supported.');
    const operation = await closeOperation(body.id);
    if (!operation) return jsonError("No active operation with that id.", 404);
    return jsonOkNoStore({ operation });
  } catch (err) {
    if (err instanceof InputError) return jsonError(err.message, 400);
    if (err instanceof ReliefStoreError) return jsonError(err.message, err.status);
    console.error("[relief-ops] PATCH failed:", err);
    return jsonError("Could not close the relief operation.", 500);
  }
}
