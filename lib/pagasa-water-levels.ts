import { withBreaker } from "@/lib/circuit-breaker";

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
};

export type WaterLevelStation = {
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

export type WaterLevelsPayload = {
  updatedAt: string | null;
  stations: WaterLevelStation[];
};

export async function fetchPagasaWaterLevels(): Promise<WaterLevelsPayload> {
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
  return { updatedAt, stations };
}

export function elevatedWaterStations(stations: WaterLevelStation[]): WaterLevelStation[] {
  return stations.filter(
    (s) => s.level === "alert" || s.level === "alarm" || s.level === "critical",
  );
}

async function resolveLatestYmdhm(): Promise<string | null> {
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
  const m = /Time\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})/i.exec(html);
  if (!m) return null;
  return m[1].replace(/[-:\s]/g, "");
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

  return {
    id: asString(raw.obscd) ?? `${name}-${lon}-${lat}`,
    name,
    lon,
    lat,
    stationType: inferStationType(asString(raw.agctype)),
    current,
    alert,
    alarm,
    critical,
    updatedAt: asString(raw.timestr) ?? asString(raw.ymdhm),
    level: inferLevel(current, alert, alarm, critical),
  };
}

function inferLevel(
  current: number | null,
  alert: number | null,
  alarm: number | null,
  critical: number | null,
): WaterLevelStation["level"] {
  if (current === null) return "nodata";
  if (critical !== null && current >= critical) return "critical";
  if (alarm !== null && current >= alarm) return "alarm";
  if (alert !== null && current >= alert) return "alert";
  return "normal";
}

function inferStationType(v: string | null): WaterLevelStation["stationType"] {
  if (v === "001") return "pagasa";
  if (v === "002") return "mmda";
  return "unknown";
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
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
