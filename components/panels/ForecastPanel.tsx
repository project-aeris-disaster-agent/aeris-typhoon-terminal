"use client";

import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import { CardHeader, Pill } from "../ui/Card";
import { PH_REGIONS } from "@/config/region";
import {
  computeForecastAlert,
  fetchForecast,
  type ForecastSummary,
} from "@/services/forecast";

export function ForecastPanel() {
  const [regionIdx, setRegionIdx] = useState(0);
  const [byRegion, setByRegion] = useState<(ForecastSummary | null)[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setByRegion(null);
    setError(null);
    void (async () => {
      const results = await Promise.all(
        PH_REGIONS.map((r) =>
          fetchForecast(r.center).catch(() => null as null),
        ),
      );
      if (cancelled) return;
      setByRegion(results);
      if (results.every((x) => x === null)) {
        setError("Could not load any regional forecasts.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedIndices = useMemo(() => {
    if (!byRegion) return [];
    const idxs = PH_REGIONS.map((_, i) => i);
    return idxs.sort((ia, ib) => {
      const fa = byRegion[ia];
      const fb = byRegion[ib];
      if (!fa && !fb) return ia - ib;
      if (!fa) return 1;
      if (!fb) return -1;
      const sa = computeForecastAlert(fa).score;
      const sb = computeForecastAlert(fb).score;
      if (sb !== sa) return sb - sa;
      return ia - ib;
    });
  }, [byRegion]);

  const loading = byRegion === null;
  const data = byRegion?.[regionIdx] ?? null;
  const selectedAlert = data ? computeForecastAlert(data) : null;

  return (
    <div className="space-y-2">
      <CardHeader
        title="7-Day Forecast"
        subtitle="Regions ranked by outlook severity (heat, rain, wind, pressure)."
        trailing={<Pill tone="accent">Open-Meteo</Pill>}
      />

      {loading && (
        <div className="text-xs text-aeris-muted">
          Loading all regions…
        </div>
      )}
      {error && (
        <div className="text-xs text-aeris-danger">Error: {error}</div>
      )}

      {!loading && byRegion && (
        <div
          className="max-h-36 overflow-y-auto rounded border border-aeris-border divide-y divide-aeris-border/50"
          role="listbox"
          aria-label="Regions sorted by forecast severity"
        >
          {sortedIndices.map((i) => {
            const r = PH_REGIONS[i];
            const f = byRegion[i];
            const alert = f ? computeForecastAlert(f) : null;
            const selected = i === regionIdx;

            return (
              <button
                key={r.code}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={!f}
                onClick={() => setRegionIdx(i)}
                className={clsx(
                  "w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors",
                  selected && "bg-aeris-accent/10",
                  !f && "opacity-50 cursor-not-allowed",
                  f && !selected && "hover:bg-aeris-elev/60",
                )}
              >
                {alert ? (
                  <Pill tone={alert.tone} className="shrink-0 !px-1.5 !py-0">
                    L{alert.level}
                  </Pill>
                ) : (
                  <span className="shrink-0 w-9 font-mono text-[9px] text-aeris-muted">
                    —
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-mono">
                  <span className="text-aeris-text">{r.code}</span>
                  <span className="text-aeris-muted"> — {r.name}</span>
                </span>
                {f && alert ? (
                  <span className="shrink-0 tabular-nums text-[10px] text-aeris-muted hidden sm:inline">
                    {Math.max(...f.daily.map((d) => d.tempMax))}° max ·{" "}
                    {f.totalRainMm} mm · {f.maxWindKph} km/h
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {selectedAlert && data && (
        <div className="text-[10px] text-aeris-muted">
          Selected outlook:{" "}
          <span className="text-aeris-text">{selectedAlert.label}</span>
        </div>
      )}

      {data && (
        <div className="space-y-1">
          <div className="grid grid-cols-3 gap-1 text-[11px] text-aeris-muted">
            <Stat label="Wind max" value={`${data.maxWindKph} km/h`} />
            <Stat label="Rain total" value={`${data.totalRainMm} mm`} />
            <Stat label="Min pres" value={`${data.minPressureHpa} hPa`} />
          </div>
          <div className="mt-1 space-y-0.5">
            {data.daily.map((d) => {
              const dayAlert = dayRowAlert(d, data);
              return (
                <div
                  key={d.date}
                  className={clsx(
                    "flex items-center justify-between text-[11px] border-b border-aeris-border/40 py-1 last:border-0 rounded-sm -mx-0.5 px-0.5",
                    dayAlert === "danger" && "bg-aeris-danger/5",
                    dayAlert === "warn" && "bg-aeris-warn/5",
                  )}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Highlight days that stand out vs the rest of the same 7-day window. */
function dayRowAlert(
  d: ForecastSummary["daily"][number],
  summary: ForecastSummary,
): "none" | "warn" | "danger" {
  const maxT = Math.max(...summary.daily.map((x) => x.tempMax));
  const maxR = Math.max(...summary.daily.map((x) => x.rainMm));
  const maxW = Math.max(...summary.daily.map((x) => x.windKph));

  const hot = d.tempMax >= 35 && d.tempMax === maxT;
  const wet = d.rainMm >= 5 && d.rainMm === maxR && d.rainMm > 0.1;
  const gusty = d.windKph >= 28 && d.windKph === maxW;

  if (d.tempMax >= 37 || d.rainMm >= 25 || d.windKph >= 45) return "danger";
  if (hot || wet || gusty) return "warn";
  return "none";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-aeris-bg/40 border border-aeris-border rounded px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wider">{label}</div>
      <div className="text-aeris-text font-mono text-[11px]">{value}</div>
    </div>
  );
}
