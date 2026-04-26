"use client";

import { useEffect, useState } from "react";
import { CardHeader, Pill } from "../ui/Card";
import { PH_REGIONS } from "@/config/region";
import {
  fetchForecast,
  type ForecastSummary,
} from "@/services/forecast";

export function ForecastPanel() {
  const [regionIdx, setRegionIdx] = useState(0);
  const [data, setData] = useState<ForecastSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const region = PH_REGIONS[regionIdx];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchForecast(region.center)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [region.center]);

  return (
    <div className="space-y-2">
      <CardHeader
        title="7-Day Forecast"
        trailing={<Pill tone="accent">Open-Meteo</Pill>}
      />

      <select
        value={regionIdx}
        onChange={(e) => setRegionIdx(Number(e.target.value))}
        className="w-full bg-aeris-bg border border-aeris-border rounded px-2 py-1 text-xs"
      >
        {PH_REGIONS.map((r, i) => (
          <option key={r.code} value={i}>
            {r.code} — {r.name}
          </option>
        ))}
      </select>

      {loading && (
        <div className="text-xs text-aeris-muted">Loading forecast…</div>
      )}
      {error && (
        <div className="text-xs text-aeris-danger">Error: {error}</div>
      )}

      {data && (
        <div className="space-y-1">
          <div className="grid grid-cols-3 gap-1 text-[11px] text-aeris-muted">
            <Stat label="Wind max" value={`${data.maxWindKph} km/h`} />
            <Stat label="Rain total" value={`${data.totalRainMm} mm`} />
            <Stat label="Min pres" value={`${data.minPressureHpa} hPa`} />
          </div>
          <div className="mt-1 space-y-0.5">
            {data.daily.map((d) => (
              <div
                key={d.date}
                className="flex items-center justify-between text-[11px] border-b border-aeris-border/40 py-1 last:border-0"
              >
                <span className="font-mono text-aeris-muted w-14">
                  {new Date(d.date).toLocaleDateString("en-PH", {
                    weekday: "short",
                    day: "2-digit",
                  })}
                </span>
                <span className="flex-1 text-right tabular-nums">
                  {d.tempMin}° / {d.tempMax}°C
                </span>
                <span className="w-16 text-right tabular-nums text-aeris-accent">
                  {d.rainMm} mm
                </span>
                <span className="w-14 text-right tabular-nums text-aeris-muted">
                  {d.windKph} km/h
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-aeris-bg/40 border border-aeris-border rounded px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wider">{label}</div>
      <div className="text-aeris-text font-mono text-[11px]">{value}</div>
    </div>
  );
}
