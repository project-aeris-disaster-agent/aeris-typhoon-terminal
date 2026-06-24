import { jsonOkNoStore } from "@/lib/api-response";
import { fetchPagasaBulletins } from "@/lib/pagasa-bulletins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const data = await fetchPagasaBulletins({ bypassCache: refresh });
  if (!data) {
    return jsonOkNoStore({ ok: false, pagasaBulletins: null });
  }
  return jsonOkNoStore({ ok: true, pagasaBulletins: data });
}
