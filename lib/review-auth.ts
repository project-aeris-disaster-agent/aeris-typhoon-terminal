import type { NextRequest } from "next/server";
import { isDashboardAuthDisabled } from "@/lib/auth-config";
import { secretsMatch } from "@/lib/internal-auth";
import { getSessionAerisRole } from "@/lib/session-auth";

export async function authorizeReportReview(
  req: NextRequest,
  actorType: "human_operator" | "ai_agent" | "system",
): Promise<{ ok: true; actorId?: string } | { ok: false; status: number; error: string }> {
  const internalSecret = process.env.INTERNAL_TRIAGE_SECRET?.trim();
  const headerSecret = req.headers.get("x-internal-triage-secret");

  if (actorType === "ai_agent" || actorType === "system") {
    // Constant-time, like every other operator-secret check (lib/internal-auth).
    // A plain `===` here leaked the secret a byte at a time to anything that
    // could time a 403, on the one path that can verify or reject reports.
    if (secretsMatch(headerSecret, internalSecret)) {
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
