import { jsonError, jsonOk } from "@/lib/api-response";
import { withBreaker } from "@/lib/circuit-breaker";

export const runtime = "edge";
export const revalidate = 300;

const PAGASA_WATER_LEVELS_URL =
  "https://pasig-marikina-tullahanffws.pagasa.dost.gov.ph/water/map_list.do";
const PAGASA_WATER_MAP_URL =
  "https://pasig-marikina-tullahanffws.pagasa.dost.gov.ph/water/map.do";

type UpstreamStation = {
  obscd?: unknown;
  agctype?: unknown;
  obsnm?: unknown;
  lon?: unknown;
  lat?: unknown;
  ymdhm?: unknown;
  timestr?: unknown;
  wl?: unknown;
  alertwl?: unknown;
  alarmwl?: unknown;
  criticalwl?: unknown;
  wlchange?: unknown;
  icon?: unknown;
};

type WaterLevelStation = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  stationType: "pagasa" | "mmda" | "unknown";
  current: number | null;
  alert: number | null;
  alarm: number | null;
  critical: number | null;
  updatedAt: string | null;
  level: "normal" | "alert" | "alarm" | "critical" | "nodata";
};

export async function GET() {
  try {
    const upstream = await withBreaker(
      "pagasa-water-levels",
      async () => {
        const ymdhm = await resolveLatestYmdhm();
        const url = new URL(PAGASA_WATER_LEVELS_URL);
        if (ymdhm) url.searchParams.set("ymdhm", ymdhm);

        const res = await fetch(url.toString(), {
          next: { revalidate: 300 },
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; AERIS-Water-Levels/1.0; +https://aeris.ph)",
            accept: "application/json,text/plain,*/*",
            referer:
              "https://pasig-marikina-tullahanffws.pagasa.dost.gov.ph/water/map.do",
          },
        });
        if (!res.ok) throw new Error(`PAGASA water levels ${res.status}`);
        return (await res.json()) as unknown;
      },
      { cooldownMs: 180_000, timeoutMs: 12_000 },
    );

    const stations = normalizeStations(upstream);
    const updatedAt = stations.find((s) => s.updatedAt)?.updatedAt ?? null;
    return jsonOk({ updatedAt, stations }, 300);
  } catch (e) {
    return jsonError((e as Error).message, 502, { updatedAt: null, stations: [] });
  }
}

async function resolveLatestYmdhm(): Promise<string | null> {
  try {
    const res = await fetch(PAGASA_WATER_MAP_URL, {
      next: { revalidate: 300 },
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; AERIS-Water-Levels/1.0; +https://aeris.ph)",
        accept: "text/html",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = /Time\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})/i.exec(
      html,
    );
    if (!m) return null;
    // "2026-05-06 04:10" -> "202605060410"
    return m[1].replace(/[-:\s]/g, "");
  } catch {
    return null;
  }
}

function normalizeStations(payload: unknown): WaterLevelStation[] {
  if (!Array.isArray(payload)) return [];
  const out: WaterLevelStation[] = [];
  for (const raw of payload) {
    const station = normalizeStation(raw as UpstreamStation);
    if (station) out.push(station);
  }
  return out;
}

function normalizeStation(raw: UpstreamStation): WaterLevelStation | null {
  const lon = toNumber(raw.lon);
  const lat = toNumber(raw.lat);
  const name = asString(raw.obsnm);
  if (lon === null || lat === null || !name) return null;

  const current = toNumber(raw.wl);
  const alert = toNumber(raw.alertwl);
  const alarm = toNumber(raw.alarmwl);
  const critical = toNumber(raw.criticalwl);
  const stationType = inferStationType(asString(raw.agctype));
  const updatedAt = asString(raw.timestr) ?? asString(raw.ymdhm);
  const level = inferLevel(current, alert, alarm, critical);

  return {
    id: asString(raw.obscd) ?? `${name}-${lon}-${lat}`,
    name,
    lon,
    lat,
    stationType,
    current,
    alert,
    alarm,
    critical,
    updatedAt,
    level,
  };
}

function inferLevel(
  current: number | null,
  alert: number | null,
  alarm: number | null,
  critical: number | null,
): "normal" | "alert" | "alarm" | "critical" | "nodata" {
  if (current === null) return "nodata";
  if (critical !== null && current >= critical) return "critical";
  if (alarm !== null && current >= alarm) return "alarm";
  if (alert !== null && current >= alert) return "alert";
  return "normal";
}

function inferStationType(v: string | null): "pagasa" | "mmda" | "unknown" {
  if (v === "001") return "pagasa";
  if (v === "002") return "mmda";
  return "unknown";
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // PAGASA often appends markers like "(*)" to values.
    const cleaned = v.replace(/[^0-9.+-]/g, "");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
