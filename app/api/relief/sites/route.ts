import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import {
  classifyRequestError,
  getRequestEvent,
  parseRequestEventId,
  REQUEST_EVENT_ID_RE,
} from "@/lib/request-api";
import { getOperation, insertSite, ReliefStoreError } from "@/lib/relief-ops";
import {
  authorizeReliefAdmin,
  httpsUrl,
  InputError,
  optionalIsoDate,
  optionalLatLon,
  optionalText,
  readJsonBody,
  requiredText,
  UUID_RE,
} from "@/lib/relief-ops-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PSGC_RE = /^[0-9]{9,10}$/;

/** Why a ReQuest event was refused, in words an LGU admin can act on. */
const EVENT_ISSUE_MESSAGES = {
  not_found: "ReQuest has no published event with that id.",
  not_allowlisted:
    "AERIS's ReQuest key can't read that event. Ask ReQuest to add it to the key's allowlist.",
  auth: "AERIS's ReQuest key was rejected. Check REQUEST_API_KEY.",
  not_configured: "ReQuest isn't connected yet (REQUEST_API_KEY is not set).",
  unavailable: "ReQuest didn't answer. Try again in a minute.",
} as const;

/**
 * POST (admin): link a ReQuest event to a relief operation as a pickup site.
 * The event is checked against ReQuest before it is saved.
 */
export async function POST(request: Request) {
  const auth = await authorizeReliefAdmin();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  try {
    const body = await readJsonBody(request);

    if (typeof body.operationId !== "string" || !UUID_RE.test(body.operationId)) {
      throw new InputError("Choose a relief operation.");
    }
    const requestEventUrl = httpsUrl(body.requestEventUrl, "ReQuest event link");
    const explicitId =
      typeof body.requestEventId === "string" && body.requestEventId.trim()
        ? body.requestEventId.trim()
        : null;
    const requestEventId = explicitId ?? parseRequestEventId(requestEventUrl);
    if (!requestEventId || !REQUEST_EVENT_ID_RE.test(requestEventId)) {
      throw new InputError("Couldn't find an event id in that link. Paste the event id too.");
    }

    const psgcCode = optionalText(body.psgcCode, 10);
    if (psgcCode && !PSGC_RE.test(psgcCode)) {
      throw new InputError("PSGC code must be 9 or 10 digits.");
    }
    const { lat, lon } = optionalLatLon(body.lat, body.lon);
    const pickupStart = optionalIsoDate(body.pickupStart, "Pickup start");
    const pickupEnd = optionalIsoDate(body.pickupEnd, "Pickup end");
    if (pickupStart && pickupEnd && Date.parse(pickupEnd) <= Date.parse(pickupStart)) {
      throw new InputError("Pickup end must be after pickup start.");
    }
    const barangay = requiredText(body.barangay, "Barangay", 2, 120);
    const pickupPoint = optionalText(body.pickupPoint, 160);
    const pack = optionalText(body.pack, 200);

    const operation = await getOperation(body.operationId);
    if (!operation) return jsonError("Relief operation not found.", 404);
    if (operation.status !== "active") return jsonError("That relief operation is closed.", 409);

    let eventTitle: string | null;
    try {
      eventTitle = (await getRequestEvent(requestEventId)).title;
    } catch (err) {
      const issue = classifyRequestError(err);
      const status = issue === "not_configured" ? 503 : issue === "unavailable" ? 502 : 422;
      return jsonError(EVENT_ISSUE_MESSAGES[issue], status, { issue });
    }

    const site = await insertSite({
      operationId: operation.id,
      requestEventId,
      requestEventUrl,
      barangay,
      psgcCode,
      pickupPoint,
      lat,
      lon,
      pickupStart,
      pickupEnd,
      pack,
      createdBy: auth.userId,
    });
    return jsonOkNoStore({ site, eventTitle }, 201);
  } catch (err) {
    if (err instanceof InputError) return jsonError(err.message, 400);
    if (err instanceof ReliefStoreError) return jsonError(err.message, err.status);
    console.error("[relief-sites] POST failed:", err);
    return jsonError("Could not link the ReQuest event.", 500);
  }
}
