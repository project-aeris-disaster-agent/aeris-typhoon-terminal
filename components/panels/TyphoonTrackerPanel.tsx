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
import {
  TYPHOON_FOCUS_EVENT,
  PAR_STORMS_EVENT,
  type TyphoonFocusDetail,
  type ParStormsDetail,
} from "@/services/live-weather-overlay";

export function TyphoonTrackerPanel({ map }: { map: MLMap | null }) {
  const [storms, setStorms] = useState<Typhoon[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
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
    if (focusedId && !storms.some((s) => s.id === focusedId)) {
      setFocusedId(null);
    }
  }, [storms, focusedId]);

  useEffect(() => {
    const storm = focusedId
      ? (storms.find((s) => s.id === focusedId) ?? null)
      : null;
    window.dispatchEvent(
      new CustomEvent<TyphoonFocusDetail>(TYPHOON_FOCUS_EVENT, {
        detail: { storm },
      }),
    );
  }, [focusedId, storms]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent<TyphoonFocusDetail>(TYPHOON_FOCUS_EVENT, {
          detail: { storm: null },
        }),
      );
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent<ParStormsDetail>(PAR_STORMS_EVENT, { detail: { storms } }),
    );
  }, [storms]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent<ParStormsDetail>(PAR_STORMS_EVENT, { detail: { storms: [] } }),
      );
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
        <div className="py-2 space-y-1">
          <div className="text-xs font-medium tracking-wide text-aeris-ok">
            NO TYPHOON THREAT ACTIVE
          </div>
          <div className="text-[11px] text-aeris-muted">
            No tropical cyclone in or approaching PAR on the last advisory check.
          </div>
        </div>
      )}

      {storms.length > 0 && !loading && (
        <p className="text-[10px] text-aeris-muted leading-snug">
          Listed storms feed cyclonic flow on the map. Tap one to boost the{" "}
          <span className="font-medium text-aeris-text/80">live weather</span> loop.
        </p>
      )}

      {storms.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() =>
            setFocusedId((cur) => (cur === s.id ? null : s.id))
          }
          className={`w-full text-left p-2 rounded border space-y-1.5 transition-colors ${
            focusedId === s.id
              ? "border-aeris-accent/60 bg-aeris-accent/10 ring-1 ring-aeris-accent/30"
              : "border-aeris-border bg-aeris-bg/40 hover:border-aeris-border/80 hover:bg-aeris-bg/55"
          }`}
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
        </button>
      ))}

      <FreshnessTag source="typhoons" />
      {warning && !error && (
        <div className="text-[11px] text-aeris-muted">
          <span className="text-aeris-warn">Feed note:</span> {warning}
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
