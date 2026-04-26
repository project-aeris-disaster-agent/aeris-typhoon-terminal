import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-response";
import { withBreaker } from "@/lib/circuit-breaker";
import { PH_BBOX } from "@/config/region";

export const runtime = "edge";

type OpenMeteoDailyPayload = {
  daily: {
    time: string[];
    temperature_2m_min: number[];
    temperature_2m_max: number[];
    precipitation_sum: number[];
    wind_speed_10m_max: number[];
    pressure_msl_min: number[];
  };
};

/**
 * Proxy for Open-Meteo 7-day forecast at a given Philippines coordinate.
 * Returns a compact summary tuned for the Forecast panel.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");

  if (latParam === null || lngParam === null) {
    return jsonError("lat and lng required", 400);
  }

  const lat = Number(latParam);
  const lng = Number(lngParam);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonError("lat and lng required", 400);
  }
  if (
    lng < PH_BBOX[0] ||
    lng > PH_BBOX[2] ||
    lat < PH_BBOX[1] ||
    lat > PH_BBOX[3]
  ) {
    return jsonError("coordinate outside Philippines", 400);
  }

  try {
    const data = await withBreaker(
      "open-meteo",
      async () => {
        const u = new URL("https://api.open-meteo.com/v1/forecast");
        u.searchParams.set("latitude", String(lat));
        u.searchParams.set("longitude", String(lng));
        u.searchParams.set(
          "daily",
          [
            "temperature_2m_min",
            "temperature_2m_max",
            "precipitation_sum",
            "wind_speed_10m_max",
            "pressure_msl_min",
          ].join(","),
        );
        u.searchParams.set("timezone", "Asia/Manila");
        u.searchParams.set("forecast_days", "7");
        u.searchParams.set("wind_speed_unit", "kmh");

        const res = await fetch(u.toString(), {
          next: { revalidate: 1800 },
        });
        if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
        const data = (await res.json()) as unknown;
        if (!isOpenMeteoPayload(data)) {
          throw new Error("Open-Meteo returned an invalid daily forecast payload.");
        }
        return data;
      },
      { cooldownMs: 30_000 },
    );

    const d = data.daily;
    const daily = d.time.map((date, i) => ({
      date,
      tempMin: Math.round(d.temperature_2m_min[i]),
      tempMax: Math.round(d.temperature_2m_max[i]),
      rainMm: Math.round(d.precipitation_sum[i] * 10) / 10,
      windKph: Math.round(d.wind_speed_10m_max[i]),
      pressureHpa: Math.round(d.pressure_msl_min[i]),
    }));

    return jsonOk(
      {
        maxWindKph: Math.max(...daily.map((x) => x.windKph)),
        totalRainMm: Math.round(daily.reduce((s, x) => s + x.rainMm, 0) * 10) / 10,
        minPressureHpa: Math.min(...daily.map((x) => x.pressureHpa)),
        daily,
      },
      900,
    );
  } catch (e) {
    return jsonError((e as Error).message, 502);
  }
}

function isOpenMeteoPayload(value: unknown): value is OpenMeteoDailyPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<OpenMeteoDailyPayload>;
  const daily = payload.daily;
  if (typeof daily !== "object" || daily === null) return false;

  const keys: Array<keyof OpenMeteoDailyPayload["daily"]> = [
    "time",
    "temperature_2m_min",
    "temperature_2m_max",
    "precipitation_sum",
    "wind_speed_10m_max",
    "pressure_msl_min",
  ];

  const time = daily.time;
  if (!Array.isArray(time) || time.length === 0 || !time.every((value) => typeof value === "string")) {
    return false;
  }

  return keys.slice(1).every((key) => {
    const series = daily[key];
    return (
      Array.isArray(series) &&
      series.length === time.length &&
      series.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    );
  });
}
