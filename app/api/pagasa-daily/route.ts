import { jsonOk, jsonOkNoStore } from "@/lib/api-response";
import { fetchPagasaDailyWeather } from "@/lib/pagasa-daily";

export const runtime = "nodejs";
export const revalidate = 1800;

export async function GET() {
  const data = await fetchPagasaDailyWeather();
  if (!data) return jsonOkNoStore({ ok: false, pagasaDaily: null });
  return jsonOk({ ok: true, pagasaDaily: data }, 1800);
}
