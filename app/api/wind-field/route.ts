import { jsonError, jsonOk } from "@/lib/api-response";
import { withBreaker } from "@/lib/circuit-breaker";
import { PAR_BBOX } from "@/config/region";
import type { WindFieldPayload } from "@/services/wind-field-types";

export const runtime = "edge";

export type { WindFieldPayload } from "@/services/wind-field-types";

/** Finer grid over PAR for smoother synoptic + LPA structure. */
const GRID_W = 16;
const GRID_H = 10;

type OmLocationBlock = {
  latitude: number;
  longitude: number;
  hourly?: {
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    pressure_msl?: number[];
  };
};

function windFromSpeedDir(speedMs: number, dirFromDeg: number): { u: number; v: number } {
  const rad = (dirFromDeg * Math.PI) / 180;
  return {
    u: -speedMs * Math.sin(rad),
    v: -speedMs * Math.cos(rad),
  };
}

function buildGridCoords(): { latitudes: string; longitudes: string } {
  const [west, south, east, north] = PAR_BBOX;
  const latList: number[] = [];
  const lngList: number[] = [];
  for (let row = 0; row < GRID_H; row++) {
    const lat = south + ((row + 0.5) / GRID_H) * (north - south);
    for (let col = 0; col < GRID_W; col++) {
      const lng = west + ((col + 0.5) / GRID_W) * (east - west);
      latList.push(lat);
      lngList.push(lng);
    }
  }
  return {
    latitudes: latList.map((n) => n.toFixed(4)).join(","),
    longitudes: lngList.map((n) => n.toFixed(4)).join(","),
  };
}

function isOmArray(value: unknown): value is OmLocationBlock[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Open-Meteo wind + MSL pressure on a PAR grid (synoptic + LPA detection client-side).
 */
export async function GET() {
  const { latitudes, longitudes } = buildGridCoords();
  const expected = GRID_W * GRID_H;

  try {
    const raw = await withBreaker(
      "open-meteo-wind-field",
      async () => {
        const u = new URL("https://api.open-meteo.com/v1/forecast");
        u.searchParams.set("latitude", latitudes);
        u.searchParams.set("longitude", longitudes);
        u.searchParams.set(
          "hourly",
          "wind_speed_10m,wind_direction_10m,pressure_msl",
        );
        u.searchParams.set("wind_speed_unit", "ms");
        u.searchParams.set("forecast_hours", "6");

        const res = await fetch(u.toString(), { next: { revalidate: 900 } });
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        return res.json() as Promise<unknown>;
      },
      { cooldownMs: 45_000, timeoutMs: 14_000 },
    );

    if (!isOmArray(raw) || raw.length !== expected) {
      throw new Error("Open-Meteo returned an unexpected wind grid payload.");
    }

    const uOut: number[] = [];
    const vOut: number[] = [];
    const pOut: number[] = [];

    for (let i = 0; i < expected; i++) {
      const block = raw[i];
      const spd = block.hourly?.wind_speed_10m?.[0];
      const dir = block.hourly?.wind_direction_10m?.[0];
      const p = block.hourly?.pressure_msl?.[0];
      if (typeof spd !== "number" || typeof dir !== "number" || !Number.isFinite(spd)) {
        uOut.push(0);
        vOut.push(0);
        pOut.push(typeof p === "number" && Number.isFinite(p) ? p : 1013);
        continue;
      }
      const { u, v } = windFromSpeedDir(spd, dir);
      uOut.push(u);
      vOut.push(v);
      pOut.push(typeof p === "number" && Number.isFinite(p) ? p : 1013);
    }

    const [west, south, east, north] = PAR_BBOX;
    const payload: WindFieldPayload = {
      width: GRID_W,
      height: GRID_H,
      west,
      south,
      east,
      north,
      u: uOut,
      v: vOut,
      p: pOut,
      generatedAt: new Date().toISOString(),
    };

    return jsonOk(payload, 900);
  } catch (e) {
    return jsonError((e as Error).message, 502);
  }
}
