import { jsonError, jsonOkNoStore } from "@/lib/api-response";
import {
  getSessionAerisRole,
  isDashboardAuthDisabled,
} from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isDashboardAuthDisabled()) {
    return jsonOkNoStore({ role: "admin", userId: null, authDisabled: true });
  }

  const session = await getSessionAerisRole();
  if (!session.userId) {
    return jsonError("Authentication required.", 401);
  }

  return jsonOkNoStore({
    role: session.role,
    userId: session.userId,
    authDisabled: false,
  });
}
