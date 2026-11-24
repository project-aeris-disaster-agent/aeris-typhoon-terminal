/**
 * Request validation + admin check shared by the /api/relief/* routes.
 */

import { PH_BBOX } from "@/config/region";
import { sanitizeText } from "@/lib/sanitize";
import { getSessionAerisRole } from "@/lib/session-auth";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string };

/** Middleware proves someone is signed in; writes need the `admin` role. */
export async function authorizeReliefAdmin(): Promise<AdminCheck> {
  const session = await getSessionAerisRole();
  if (!session.userId) return { ok: false, status: 401, error: "Authentication required." };
  if (session.role !== "admin") {
    return { ok: false, status: 403, error: "Admin role required to manage relief operations." };
  }
  return { ok: true, userId: session.userId };
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function requiredText(value: unknown, field: string, min: number, max: number): string {
  const text = optionalText(value, max);
  if (!text || text.length < min) throw new InputError(`${field} is required (${min}–${max} characters).`);
  return text;
}

export function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new InputError("Expected text.");
  const text = sanitizeText(value, max);
  return text || null;
}

export function optionalIsoDate(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new InputError(`${field} must be a date and time.`);
  }
  return new Date(value).toISOString();
}

export function optionalLatLon(
  lat: unknown,
  lon: unknown,
): { lat: number | null; lon: number | null } {
  const blank = (v: unknown) => v == null || v === "";
  if (blank(lat) && blank(lon)) return { lat: null, lon: null };
  const la = typeof lat === "string" ? Number(lat) : lat;
  const lo = typeof lon === "string" ? Number(lon) : lon;
  const [minLon, minLat, maxLon, maxLat] = PH_BBOX;
  if (
    typeof la !== "number" ||
    typeof lo !== "number" ||
    !Number.isFinite(la) ||
    !Number.isFinite(lo) ||
    la < minLat ||
    la > maxLat ||
    lo < minLon ||
    lo > maxLon
  ) {
    throw new InputError("Latitude and longitude must both be set, inside the Philippines.");
  }
  return { lat: la, lon: lo };
}

export function httpsUrl(value: unknown, field: string): string {
  if (typeof value !== "string") throw new InputError(`${field} is required.`);
  const raw = value.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InputError(`${field} must be a link.`);
  }
  if (url.protocol !== "https:" || raw.length > 500) {
    throw new InputError(`${field} must be an https link.`);
  }
  return url.toString();
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InputError("Expected a JSON object.");
  }
  return body as Record<string, unknown>;
}
