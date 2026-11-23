import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import { resolveSessionUserId } from "@/lib/session-auth";
import { listAgentMessages, supabaseAgentEnabled } from "@/lib/supabase-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!supabaseAgentEnabled()) {
    return jsonOkNoStore({ messages: [], configured: false });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam), 100) : 50;

  if (!Number.isFinite(limit) || limit < 1) {
    return jsonError("Invalid limit.", 400);
  }

  const userId = await resolveSessionUserId();
  const messages = await listAgentMessages(limit, { userId });
  return jsonOkNoStore({ messages, configured: true });
}
