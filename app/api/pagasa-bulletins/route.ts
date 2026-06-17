import { jsonOk, jsonOkNoStore } from "@/lib/api-response";
import { fetchPagasaBulletins } from "@/lib/pagasa-bulletins";

export const runtime = "nodejs";
export const revalidate = 900;

export async function GET() {
  const data = await fetchPagasaBulletins();
  if (!data) return jsonOkNoStore({ ok: false, pagasaBulletins: null });
  return jsonOk({ ok: true, pagasaBulletins: data }, 900);
}
