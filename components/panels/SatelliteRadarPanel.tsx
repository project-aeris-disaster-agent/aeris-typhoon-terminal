"use client";

import { useEffect, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import {
  fetchRadarFrames,
  gibsAnimationFrames,
  type RadarFramesResult,
  type RadarFrame,
} from "@/services/satellite-frames";
import {
  setLiveWeatherImagerySource,
  type LiveImagerySource,
  type LiveWeatherFrameDetail,
} from "@/services/live-weather-overlay";
import { FreshnessTag } from "../ui/FreshnessTag";

const SOURCES: Record<
  LiveImagerySource,
  { label: string; short: string; hint: string }
> = {
  radar: {
    label: "RainViewer Radar",
    short: "Radar",
    hint: "Precipitation — last ~2h + nowcast",
  },
  "himawari-true": {
    label: "Himawari visible",
    short: "VIS",
    hint: "GIBS Band 3 red / visible (1 km) — daylight clouds",
  },
  "himawari-ir": {
    label: "Himawari infrared",
    short: "IR",
    hint: "GIBS Band 13 clean IR — cloud tops / night",
  },
};

export function SatelliteRadarPanel({ map }: { map: MLMap | null }) {
  const [source, setSource] = useState<LiveImagerySource>("radar");
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [loopCount, setLoopCount] = useState(0);
  const [loopTime, setLoopTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onFrame = (ev: Event) => {
      const e = ev as CustomEvent<LiveWeatherFrameDetail>;
      if (!e.detail || e.detail.source !== source) return;
      setFrameIdx(e.detail.index);
      setLoopCount(e.detail.count);
      setLoopTime(e.detail.time);
    };
    window.addEventListener("aeris:live-weather-frame", onFrame as EventListener);
    return () =>
      window.removeEventListener("aeris:live-weather-frame", onFrame as EventListener);
  }, [source]);

  useEffect(() => {
    if (!map) return;
    setLoopTime(null);
    setLiveWeatherImagerySource(map, source);
    if (source === "radar") {
      setError(null);
      fetchRadarFrames()
        .then((result: RadarFramesResult) => {
          setFrames(result.frames);
          setFrameIdx(Math.max(0, result.frames.length - 1));
        })
        .catch((radarError) => {
          setFrames([]);
          setFrameIdx(0);
          setError((radarError as Error).message);
        });
    } else {
      setError(null);
      const frames = gibsAnimationFrames();
      setFrames(frames);
      setFrameIdx(frames.length - 1);
    }
  }, [map, source]);

  const displayTime =
    loopTime ?? frames[Math.min(frameIdx, Math.max(0, frames.length - 1))]?.time ?? "";

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

      <p className="text-[10px] text-aeris-muted leading-relaxed">
        Radar and satellite loop automatically on the{" "}
        <span className="font-medium text-aeris-text/85">2D</span> map.
        Wind streaks use PAR synoptic flow (Open-Meteo), active storm circulation
        (JTWC), and weak lows from the pressure field.
      </p>

      {error && (
        <div className="rounded border border-aeris-danger/40 bg-aeris-danger/10 px-2 py-1.5 text-[11px] text-aeris-danger">
          {error}
        </div>
      )}

      {source === "radar" && !error && <FreshnessTag source="radar" />}

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

      <div className="rounded-md border border-aeris-border/60 bg-gradient-to-br from-aeris-bg/50 to-aeris-surface/40 px-2.5 py-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10px] uppercase tracking-wider text-aeris-muted">
            Frame
          </span>
          <span className="text-[10px] font-mono text-aeris-accent/90 tabular-nums">
            {loopCount || frames.length
              ? `${frameIdx + 1} / ${loopCount || frames.length}`
              : "—"}
          </span>
        </div>
        <div className="h-1 rounded-full bg-aeris-border/50 overflow-hidden">
          {(loopCount || frames.length) > 0 && (
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500/70 to-aeris-accent transition-[width] duration-300 ease-out"
              style={{
                width: `${((frameIdx + 1) / (loopCount || frames.length)) * 100}%`,
              }}
            />
          )}
        </div>
        <div className="mt-1.5 text-[11px] text-aeris-muted font-mono text-center">
          {displayTime
            ? new Date(displayTime).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : error
              ? "—"
              : "Loading…"}
        </div>
      </div>
    </div>
  );
}
