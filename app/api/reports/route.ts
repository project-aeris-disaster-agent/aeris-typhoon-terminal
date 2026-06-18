import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/kv";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sanitizeText, isSafeUrl, isSpam } from "@/lib/sanitize";
import { PH_BBOX } from "@/config/region";
import { jsonError } from "@/lib/api-response";
import {
  createSupabaseReport,
  listSupabaseReports,
  supabaseReportsEnabled,
} from "@/lib/supabase-reports";
import { resolveSessionUserId } from "@/lib/session-user";
import { awardXp } from "@/lib/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORTS_KEY = "reports:list";
const TTL_SECONDS = 72 * 60 * 60;
const MAX_RETENTION = 500;
const ALLOWED_CATEGORIES = new Set([
  "flood",
  "landslide",
  "stranded",
  "SOS",
  "infra_damage",
  "power_out",
  "road_closed",
]);

type StoredReport = {
  id: string;
  category: string;
  description: string;
  position: [number, number];
  photoUrl?: string;
  createdAt: string;
  confirmations: number;
  ipHash: string;
  metadata?: Record<string, unknown>;
};

export async function GET() {
  if (supabaseReportsEnabled()) {
    try {
      const reports = await listSupabaseReports();
      return NextResponse.json(
        { reports },
        {
          status: 200,
          headers: {
            "cache-control": "no-store",
          },
        },
      );
    } catch (error) {
      // Keep the operations panel usable during a Supabase outage by falling
      // back to the legacy short-lived KV feed.
    }
  }

  const raw = await store.lrange(REPORTS_KEY, 0, MAX_RETENTION - 1);
  const now = Date.now();
  const reports = raw
    .map((s) => {
      try {
        return JSON.parse(s) as StoredReport;
      } catch {
        return null;
      }
    })
    .filter((r): r is StoredReport => !!r)
    .filter((r) => now - new Date(r.createdAt).getTime() < TTL_SECONDS * 1000)
    .map(({ ipHash: _ip, metadata: _metadata, ...rest }) => rest);

  return NextResponse.json(
    { reports },
    {
      status: 200,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  const limit = await rateLimit({
    key: `reports:${ip}`,
    max: 5,
    windowSeconds: 10 * 60,
  });
  if (!limit.allowed) {
    return jsonError("Rate limit exceeded. Try again in a few minutes.", 429, {
      resetSeconds: limit.resetSeconds,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const validated = validate(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  // Optional: award the reporter XP when they are signed in (anonymous reports
  // simply skip the award). Resolved up front so both storage paths can use it.
  const reporterId = await resolveSessionUserId();

  const { category, description, position, photoUrl, locationAccuracyM, metadata } = validated.data;
  const ipHash = await hashIp(ip);
  const reportMetadata = {
    userAgent: req.headers.get("user-agent"),
    ipAddress: ip,
    ipHash,
    client: metadata ?? null,
  };

  const report: StoredReport = {
    id: crypto.randomUUID(),
    category,
    description,
    position,
    photoUrl,
    createdAt: new Date().toISOString(),
    confirmations: 0,
    ipHash,
    metadata: reportMetadata,
  };

  if (supabaseReportsEnabled()) {
    try {
      const publicReport = await createSupabaseReport({
        category,
        description,
        position,
        photoUrl,
        locationAccuracyM,
        ipHash: report.ipHash,
        metadata: reportMetadata,
        reporterUserId: reporterId ?? undefined,
      });
      if (reporterId) {
        await awardXp(reporterId, "submit_report", {
          refId: publicReport.id,
          dedupeKey: `submit_report:${publicReport.id}`,
        });
      }
      return NextResponse.json(
        { report: publicReport },
        {
          status: 201,
          headers: { "cache-control": "no-store" },
        },
      );
    } catch {
      // Fall through to KV. This preserves local/dev behavior and prevents a
      // reporting outage if the shared intake database is temporarily down.
    }
  }

  await store.lpush(REPORTS_KEY, JSON.stringify(report));
  await store.ltrim(REPORTS_KEY, 0, MAX_RETENTION - 1);

  if (reporterId) {
    await awardXp(reporterId, "submit_report", {
      refId: report.id,
      dedupeKey: `submit_report:${report.id}`,
    });
  }

  const { ipHash: _ip, metadata: _metadata, ...publicReport } = report;
  return NextResponse.json(
    { report: publicReport },
    {
      status: 201,
      headers: { "cache-control": "no-store" },
    },
  );
}

type ValidReport = {
  category: string;
  description: string;
  position: [number, number];
  photoUrl?: string;
  locationAccuracyM?: number;
  metadata?: Record<string, unknown>;
};

function validate(
  body: unknown,
):
  | { ok: true; data: ValidReport }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const b = body as Record<string, unknown>;

  const category = String(b.category ?? "");
  if (!ALLOWED_CATEGORIES.has(category)) {
    return { ok: false, error: `Invalid category.` };
  }

  const description = sanitizeText(String(b.description ?? ""));
  if (description.length < 3) {
    return { ok: false, error: "Description too short." };
  }
  if (isSpam(description)) {
    return { ok: false, error: "Report rejected." };
  }

  const pos = b.position as unknown;
  if (
    !Array.isArray(pos) ||
    pos.length !== 2 ||
    !Number.isFinite(pos[0]) ||
    !Number.isFinite(pos[1])
  ) {
    return { ok: false, error: "Invalid position." };
  }
  const lng = Number(pos[0]);
  const lat = Number(pos[1]);
  if (
    lng < PH_BBOX[0] ||
    lng > PH_BBOX[2] ||
    lat < PH_BBOX[1] ||
    lat > PH_BBOX[3]
  ) {
    return { ok: false, error: "Coordinates outside Philippines." };
  }

  let photoUrl: string | undefined;
  if (b.photoUrl) {
    const p = String(b.photoUrl);
    if (!isSafeUrl(p)) return { ok: false, error: "Invalid photo URL." };
    photoUrl = p;
  }

  return {
    ok: true,
    data: {
      category,
      description,
      position: [lng, lat],
      photoUrl,
      locationAccuracyM: Number.isFinite(Number(b.locationAccuracyM))
        ? Number(b.locationAccuracyM)
        : undefined,
      metadata: sanitizeMetadata(b.metadata),
    },
  };
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  const sanitized = sanitizeJsonValue(value, 0);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : undefined;
}

function sanitizeJsonValue(value: unknown, depth: number): unknown {
  if (depth > 4 || value == null) return undefined;

  if (typeof value === "string") return sanitizeText(value, 500);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, item]) => [sanitizeText(key, 80), sanitizeJsonValue(item, depth + 1)])
        .filter(([key, item]) => key && item !== undefined),
    );
  }

  return undefined;
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "|aeris-salt");
  const buf = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
