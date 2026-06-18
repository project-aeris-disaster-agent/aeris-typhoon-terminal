import { NextRequest, NextResponse } from "next/server";
import {
  type ReportReviewAction,
  reviewSupabaseReport,
  supabaseReportsEnabled,
  supabaseServiceRoleEnabled,
} from "@/lib/supabase-reports";
import { jsonError } from "@/lib/api-response";
import { authorizeReportReview } from "@/lib/review-auth";
import { awardXp } from "@/lib/gamification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<ReportReviewAction>([
  "verify",
  "reject",
  "duplicate",
  "hide",
  "unhide",
  "needs_review",
  "unverify",
  "note",
  "confidence_adjust",
]);

const ACTOR_TYPES = new Set(["human_operator", "ai_agent", "system"]);

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: reportId } = await context.params;
  if (!supabaseReportsEnabled()) {
    return jsonError("Shared Supabase reports are not configured.", 503);
  }
  if (!supabaseServiceRoleEnabled()) {
    return jsonError(
      "Report review requires SUPABASE_SERVICE_ROLE_KEY with role service_role.",
      503,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const validated = validateReview(body);
  if (!validated.ok) return jsonError(validated.error, 400);

  const auth = await authorizeReportReview(req, validated.data.actorType);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  try {
    const report = await reviewSupabaseReport({
      reportId,
      ...validated.data,
      actorId: validated.data.actorId ?? auth.actorId,
      metadata: {
        ...validated.data.metadata,
        requestSource: "aeris-dashboard-api",
      },
    });

    // Gamification (idempotent per report; AI/system actors and the dev
    // placeholder operator are excluded):
    if (validated.data.action === "verify") {
      //  • reward the human operator for verifying the report
      const operatorId = validated.data.actorId ?? auth.actorId;
      if (
        validated.data.actorType === "human_operator" &&
        operatorId &&
        operatorId !== "dashboard-operator"
      ) {
        await awardXp(operatorId, "review_report", {
          refId: reportId,
          dedupeKey: `review_report:${reportId}`,
        });
      }

      //  • reward the original reporter (Privy DID) once their report is verified
      if (report.reporterUserId) {
        await awardXp(report.reporterUserId, "report_verified", {
          refId: reportId,
          dedupeKey: `report_verified:${reportId}`,
        });
      }
    }

    return NextResponse.json(
      { report },
      {
        status: 200,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return jsonError((error as Error).message, 502);
  }
}

type ValidReview = {
  action: ReportReviewAction;
  actorType: "human_operator" | "ai_agent" | "system";
  actorId?: string;
  note?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

function validateReview(
  body: unknown,
): { ok: true; data: ValidReview } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be an object." };
  }
  const value = body as Record<string, unknown>;
  const action = String(value.action ?? "") as ReportReviewAction;
  if (!ACTIONS.has(action)) return { ok: false, error: "Invalid review action." };

  const actorType = String(value.actorType ?? "human_operator");
  if (!ACTOR_TYPES.has(actorType)) {
    return { ok: false, error: "Invalid actor type." };
  }

  const confidence =
    value.confidence === undefined ? undefined : Number(value.confidence);
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    return { ok: false, error: "Confidence must be between 0 and 1." };
  }

  return {
    ok: true,
    data: {
      action,
      actorType: actorType as ValidReview["actorType"],
      actorId: sanitizeText(value.actorId, 120),
      note: sanitizeText(value.note, 500),
      confidence,
      metadata: sanitizeMetadata(value.metadata),
    },
  };
}

function sanitizeText(value: unknown, maxLen: number) {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return text || undefined;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .map(([key, item]) => [String(key).slice(0, 80), sanitizeMetadataValue(item)])
      .filter(([, item]) => item !== undefined),
  );
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined;
}
