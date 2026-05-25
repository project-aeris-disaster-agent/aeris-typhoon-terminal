"use client";

import { useEffect, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import {
  getLiveWeatherSourceContract,
  type LiveImagerySource,
} from "@/services/satellite-frames";
import {
  setLiveWeatherImagerySource,
  LIVE_WEATHER_STATUS_EVENT,
  type LiveWeatherFrameDetail,
  type LiveWeatherStatusDetail,
} from "@/services/live-weather-overlay";
import { FreshnessTag } from "../ui/FreshnessTag";

const SOURCES: Record<
  LiveImagerySource,
  { label: string; short: string; hint: string }
> = {
  radar: {
    label: "Precipitation radar",
    short: "Radar",
    hint: "RainViewer composite — observed past 2h + 30 min nowcast (forecast frames are flagged)",
  },
  "himawari-airmass": {
    label: "Air Mass (false color)",
    short: "AIR MASS",
    hint: "GIBS Himawari-9 Air_Mass RGB composite — day/night stable atmospheric analysis",
  },
  "himawari-ir": {
    label: "Infrared (Band 13)",
    short: "IR",
    hint: "RainViewer Clean IR (fallback: GIBS Himawari Band 13) — cloud-top temperature",
  },
};

/** Freshness key written by `fetchSatelliteFrames` / `fetchRadarFrames`. */
function freshnessKeyFor(source: LiveImagerySource): string {
  return source === "radar" ? "radar" : `satellite:${source}`;
}

export function SatelliteRadarPanel({ map }: { map: MLMap | null }) {
  const [source, setSource] = useState<LiveImagerySource>("radar");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveWeatherStatusDetail | null>(null);
  const [frame, setFrame] = useState<LiveWeatherFrameDetail | null>(null);

  useEffect(() => {
    const onStatus = (ev: Event) => {
      const e = ev as CustomEvent<LiveWeatherStatusDetail>;
      if (!e.detail || e.detail.source !== source) return;
      setStatus(e.detail);
    };
    const onFrame = (ev: Event) => {
      const e = ev as CustomEvent<LiveWeatherFrameDetail>;
      if (!e.detail || e.detail.source !== source) return;
      setFrame(e.detail);
    };
    window.addEventListener(LIVE_WEATHER_STATUS_EVENT, onStatus as EventListener);
    window.addEventListener("aeris:live-weather-frame", onFrame as EventListener);
    return () => {
      window.removeEventListener(LIVE_WEATHER_STATUS_EVENT, onStatus as EventListener);
      window.removeEventListener(
        "aeris:live-weather-frame",
        onFrame as EventListener,
      );
    };
  }, [source]);

  useEffect(() => {
    if (!map) return;
    setStatus(null);
    setFrame(null);
    setLiveWeatherImagerySource(map, source);
    setError(null);
  }, [map, source]);

  const contract = getLiveWeatherSourceContract(source);
  const healthTone =
    status?.health === "fallback"
      ? "text-amber-300 border-amber-500/35 bg-amber-500/10"
      : status?.health === "delayed"
        ? "text-yellow-300 border-yellow-500/35 bg-yellow-500/10"
        : "text-emerald-300 border-emerald-500/35 bg-emerald-500/10";
  const healthLabel =
    status?.health === "fallback"
      ? "Fallback"
      : status?.health === "delayed"
        ? "Delayed"
        : "Live";

  const isForecastFrame = frame?.kind === "nowcast";

  return (
    <div className="space-y-3">
      <CardHeader
        title="Live weather"
        trailing={
          <Pill tone="accent" className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]"
              aria-hidden
            />
            Loop
          </Pill>
        }
      />

      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="text-aeris-muted uppercase tracking-wider">Status</span>
        <span className={`rounded border px-1.5 py-0.5 font-medium ${healthTone}`}>
          {healthLabel}
        </span>
        {status?.frameAgeMinutes != null && (
          <span className="text-aeris-muted">
            Frame age {status.frameAgeMinutes}m
            {status.frameAgeMinutes > contract.staleAfterMinutes ? " (stale)" : ""}
          </span>
        )}
        {isForecastFrame && (
          <span
            className="rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-orange-300"
            title="Model nowcast — forecast precipitation, not an observed scan"
          >
            Forecast
          </span>
        )}
      </div>
      <div className="text-[10px] text-aeris-muted/80">
        Source: {frame?.attribution ?? contract.attribution}
      </div>

      {error && (
        <div className="rounded border border-aeris-danger/40 bg-aeris-danger/10 px-2 py-1.5 text-[11px] text-aeris-danger">
          {error}
        </div>
      )}
      {!error && status?.message && (
        <div className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
          {status.message}
        </div>
      )}

      {!error && <FreshnessTag source={freshnessKeyFor(source)} />}

      <div className="rounded-lg border border-aeris-border/80 bg-aeris-bg/30 p-0.5 flex gap-0.5">
        {(Object.keys(SOURCES) as LiveImagerySource[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSource(k)}
            title={SOURCES[k].hint}
            className={`flex-1 min-w-0 rounded-md px-2 py-2 text-left transition-colors ${
              source === k
                ? "bg-aeris-accent/15 text-aeris-accent shadow-sm border border-aeris-accent/25"
                : "text-aeris-muted hover:text-aeris-text hover:bg-aeris-elev/60 border border-transparent"
            }`}
          >
            <div className="text-[10px] font-mono uppercase tracking-wider opacity-80">
              {SOURCES[k].short}
            </div>
            <div className="text-[11px] font-medium truncate">{SOURCES[k].label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
