import { jsonError, jsonOk } from "@/lib/api-response";
import { fetchPagasaWaterLevels } from "@/lib/pagasa-water-levels";

export const runtime = "edge";
export const revalidate = 300;

export async function GET() {
  try {
    const payload = await fetchPagasaWaterLevels();
    return jsonOk(payload, 300);
  } catch (e) {
    return jsonError((e as Error).message, 502, { updatedAt: null, stations: [] });
  }
}
