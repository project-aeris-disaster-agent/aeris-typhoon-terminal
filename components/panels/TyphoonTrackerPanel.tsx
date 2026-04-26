"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import { FreshnessTag } from "../ui/FreshnessTag";
import {
  fetchActiveTyphoons,
  renderTyphoonOnMap,
  clearTyphoonFromMap,
  type Typhoon,
} from "@/services/typhoon-tracks";

export function TyphoonTrackerPanel({ map }: { map: MLMap | null }) {
  const [storms, setStorms] = useState<Typhoon[]>([]);
  // Only set `loading` on the first fetch — subsequent 15-min polls must not
  // flicker the panel back to "loading" while valid data is already on screen.
  const [loading, setLoading] = useState(true);
  const isFirstRun = useRef(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isFirstRun.current) setLoading(true);
      try {
        const result = await fetchActiveTyphoons();
        if (!cancelled) {
          setStorms(result.storms);
          setWarning(result.warning);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          isFirstRun.current = false;
        }
      }
    };
    run();
    const id = window.setInterval(run, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    for (const s of storms) renderTyphoonOnMap(map, s);
    return () => {
      for (const s of storms) clearTyphoonFromMap(map, s.id);
    };
  }, [map, storms]);

  return (
    <div className="space-y-2">
      <CardHeader
        title="Active Storms"
        trailing={
          loading ? (
            <Pill>loading</Pill>
          ) : error ? (
            <Pill tone="danger">err</Pill>
          ) : (
            <Pill tone={storms.length ? "warn" : "ok"}>
              {storms.length} active
            </Pill>
          )
        }
      />

      {storms.length === 0 && !loading && !error && (
        <div className="text-xs text-aeris-muted py-2">
          No active typhoons in or approaching PAR.
        </div>
      )}

      {storms.map((s) => (
        <div
          key={s.id}
          className="p-2 rounded border border-aeris-border bg-aeris-bg/40 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <div className="font-mono text-sm text-aeris-warn">
              {s.localName ?? s.name}
            </div>
            <Pill tone={categoryTone(s.category)}>{s.category}</Pill>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px] text-aeris-muted">
            <Metric label="Wind" value={`${s.windKph} km/h`} />
            <Metric label="Pressure" value={`${s.pressureHpa} hPa`} />
            <Metric
              label="Position"
              value={`${s.position[1].toFixed(1)}°N, ${s.position[0].toFixed(1)}°E`}
            />
            <Metric label="Heading" value={s.heading ?? "—"} />
          </div>
          {s.landfallEta && (
            <div className="text-[11px] text-aeris-warn">
              Landfall ETA: {s.landfallEta}
            </div>
          )}
        </div>
      ))}

      <FreshnessTag source="typhoons" />
      {warning && !error && (
        <div className="text-[11px] text-aeris-warn">
          Degraded source: {warning}
        </div>
      )}

      {error && (
        <div className="text-[11px] text-aeris-danger">
          Source unreachable: {error}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider">{label}</div>
      <div className="text-aeris-text font-mono">{value}</div>
    </div>
  );
}

function categoryTone(c: string) {
  if (/Super|5|4/.test(c)) return "danger" as const;
  if (/Typhoon|3/.test(c)) return "warn" as const;
  return "accent" as const;
}
