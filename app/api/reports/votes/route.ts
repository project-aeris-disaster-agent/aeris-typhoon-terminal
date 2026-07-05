import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { getReportVotesByUser, reportVotesEnabled } from "@/lib/report-votes";
import { resolveSessionUserId } from "@/lib/session-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The session user's report votes, as a reportId -> "up" | "down" map. */
export async function GET() {
  if (!reportVotesEnabled()) {
    return jsonError("Report votes are not configured.", 503);
  }

  const userId = await resolveSessionUserId();
  if (!userId) return jsonError("Authentication required.", 401);

  const votes = await getReportVotesByUser(userId);
  return jsonOkNoStore({ votes });
}
