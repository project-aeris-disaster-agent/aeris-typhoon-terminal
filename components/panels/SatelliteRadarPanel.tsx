"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import {
  ensureGibsLayer,
  ensureRadarLayer,
  setFrameTimestamp,
  fetchRadarFrames,
  type RadarFramesResult,
  type RadarFrame,
} from "@/services/satellite-frames";
import { FreshnessTag } from "../ui/FreshnessTag";

type SourceKey = "himawari-true" | "himawari-ir" | "radar";

const SOURCES: Record<SourceKey, { label: string; kind: "gibs" | "radar" }> = {
  "himawari-true": { label: "Himawari True Color", kind: "gibs" },
  "himawari-ir": { label: "Himawari Infrared", kind: "gibs" },
  radar: { label: "RainViewer Radar", kind: "radar" },
};

export function SatelliteRadarPanel({ map }: { map: MLMap | null }) {
  const [source, setSource] = useState<SourceKey>("radar");
  const [playing, setPlaying] = useState(false);
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!map) return;
    if (source === "radar") {
      setError(null);
      fetchRadarFrames()
        .then((result: RadarFramesResult) => {
          setFrames(result.frames);
          const nextIndex = Math.max(0, result.frames.length - 1);
          setFrameIdx(nextIndex);
          ensureRadarLayer(map, result.frames[nextIndex]);
        })
        .catch((radarError) => {
          setFrames([]);
          setFrameIdx(0);
          setError((radarError as Error).message);
        });
    } else {
      ensureGibsLayer(map, source);
      setError(null);
      const now = new Date();
      now.setUTCMinutes(0, 0, 0);
      const hours: RadarFrame[] = [];
      for (let i = 11; i >= 0; i--) {
        hours.push({
          time: new Date(now.getTime() - i * 3600 * 1000).toISOString(),
          path: "",
        });
      }
      setFrames(hours);
      setFrameIdx(hours.length - 1);
    }
  }, [map, source]);

  useEffect(() => {
    if (!map || frames.length === 0) return;
    const frame = frames[frameIdx];
    setFrameTimestamp(map, source, frame);
  }, [map, source, frames, frameIdx]);

  useEffect(() => {
    if (!playing) return;
    const step = () => {
      setFrameIdx((i) => (i + 1) % Math.max(1, frames.length));
      rafRef.current = window.setTimeout(step, 500) as unknown as number;
    };
    rafRef.current = window.setTimeout(step, 500) as unknown as number;
    return () => {
      if (rafRef.current !== null) window.clearTimeout(rafRef.current);
    };
  }, [playing, frames.length]);

  const currentTime = useMemo(
    () => frames[frameIdx]?.time ?? "",
    [frames, frameIdx],
  );

  return (
    <div className="space-y-2">
      <CardHeader
        title="Animated Imagery"
        trailing={<Pill tone="accent">{frames.length} frames</Pill>}
      />
      {error && <div className="text-xs text-aeris-danger">Error: {error}</div>}
      {source === "radar" && <FreshnessTag source="radar" />}

      <div className="flex gap-1">
        {(Object.keys(SOURCES) as SourceKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setPlaying(false);
              setSource(k);
            }}
            className={`flex-1 px-1.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider border ${
              source === k
                ? "bg-aeris-accent/10 text-aeris-accent border-aeris-accent/30"
                : "bg-aeris-bg/40 text-aeris-muted border-aeris-border hover:text-aeris-text"
            }`}
          >
            {SOURCES[k].label.split(" ")[0]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="px-2 py-1 rounded border border-aeris-border text-xs hover:border-aeris-accent hover:text-aeris-accent"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={frameIdx}
          onChange={(e) => setFrameIdx(Number(e.target.value))}
          className="flex-1 accent-aeris-accent"
        />
      </div>

      <div className="text-[11px] text-aeris-muted font-mono">
        {currentTime ? new Date(currentTime).toLocaleString() : error ? "Frames unavailable" : "Loading…"}
      </div>
    </div>
  );
}
