import type { NextRequest } from "next/server";
import {
  getSessionAerisRole,
  isDashboardAuthDisabled,
} from "@/lib/supabase-server";

export async function authorizeReportReview(
  req: NextRequest,
  actorType: "human_operator" | "ai_agent" | "system",
): Promise<{ ok: true; actorId?: string } | { ok: false; status: number; error: string }> {
  const internalSecret = process.env.INTERNAL_TRIAGE_SECRET?.trim();
  const headerSecret = req.headers.get("x-internal-triage-secret");

  if (actorType === "ai_agent" || actorType === "system") {
    if (internalSecret && headerSecret === internalSecret) {
      return { ok: true, actorId: "aeris-ai-triage" };
    }
    return { ok: false, status: 403, error: "Internal authorization required." };
  }

  if (isDashboardAuthDisabled()) {
    return { ok: true, actorId: "dashboard-operator" };
  }

  const session = await getSessionAerisRole();
  if (!session.userId) {
    return { ok: false, status: 401, error: "Authentication required." };
  }
  if (session.role !== "admin") {
    return { ok: false, status: 403, error: "Admin role required for report review." };
  }

  return { ok: true, actorId: session.userId };
}
