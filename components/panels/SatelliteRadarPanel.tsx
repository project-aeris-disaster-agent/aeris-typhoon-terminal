"use client";

import { useEffect, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
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
    short: "Air mass",
    hint: "GIBS Himawari-9 Air_Mass RGB composite — day/night stable atmospheric analysis",
  },
  "himawari-ir": {
    label: "Infrared (Band 13)",
    short: "IR",
    hint: "RainViewer Clean IR (fallback: GIBS Himawari Band 13) — cloud-top temperature",
  },
};

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
  const isStale =
    status?.frameAgeMinutes != null &&
    status.frameAgeMinutes > contract.staleAfterMinutes;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] leading-tight">
        <span
          className={clsx(
            "rounded border px-1 py-px font-medium uppercase tracking-wide",
            healthTone,
          )}
        >
          {healthLabel}
        </span>
        {status?.frameAgeMinutes != null && (
          <span className="text-aeris-muted">
            · {status.frameAgeMinutes}m
            {isStale ? " stale" : ""}
          </span>
        )}
        {isForecastFrame && (
          <span
            className="rounded border border-orange-500/40 bg-orange-500/10 px-1 py-px font-semibold uppercase tracking-wide text-orange-300"
            title="Model nowcast — forecast precipitation, not an observed scan"
          >
            Forecast
          </span>
        )}
        {!error && (
          <FreshnessTag
            source={freshnessKeyFor(source)}
            className="text-aeris-muted/80"
          />
        )}
      </div>

      {error && (
        <p className="rounded border border-aeris-danger/40 bg-aeris-danger/10 px-1.5 py-1 text-[10px] leading-snug text-aeris-danger">
          {error}
        </p>
      )}
      {!error && status?.message && (
        <p className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-1 text-[10px] leading-snug text-amber-300">
          {status.message}
        </p>
      )}

      <div className="flex gap-0.5 rounded-md border border-aeris-border/80 bg-aeris-bg/30 p-0.5">
        {(Object.keys(SOURCES) as LiveImagerySource[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSource(k)}
            title={SOURCES[k].hint}
            aria-label={SOURCES[k].label}
            className={clsx(
              "min-w-0 flex-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors",
              source === k
                ? "border border-aeris-accent/25 bg-aeris-accent/15 text-aeris-accent shadow-sm"
                : "border border-transparent text-aeris-muted hover:bg-aeris-elev/60 hover:text-aeris-text",
            )}
          >
            {SOURCES[k].short}
          </button>
        ))}
      </div>
    </div>
  );
}
