"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import { LIVE_WEATHER_PANEL } from "@/config/panels";
import { LiveWeatherFrameIndicator } from "@/components/LiveWeatherFrameHud";

const PanelSkeleton = () => (
  <div className="h-12 rounded border border-aeris-border/80 bg-aeris-bg/40 px-2 text-[10px] text-aeris-muted inline-flex items-center gap-2">
    <span className="inline-block h-1.5 w-1.5 rounded-full bg-aeris-accent animate-pulse" />
    <span>Loading radar…</span>
  </div>
);

const SatelliteRadarPanel = dynamic(
  () =>
    import("./panels/SatelliteRadarPanel").then((m) => ({
      default: m.SatelliteRadarPanel,
    })),
  { ssr: false, loading: PanelSkeleton },
);

export function LiveWeatherMapPanel({ map }: { map: MLMap | null }) {
  const [open, setOpen] = useState(LIVE_WEATHER_PANEL.defaultOpen);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === LIVE_WEATHER_PANEL.hotkey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="panel-glass rounded-md font-mono text-[11px] w-full max-w-[280px]">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-1.5 py-1 text-aeris-muted hover:text-aeris-text transition-colors"
        aria-expanded={open}
        aria-controls="live-weather-map-panel"
      >
        <span className="shrink-0 text-[9px] uppercase tracking-wider text-aeris-accent/80">
          {LIVE_WEATHER_PANEL.hotkey}
        </span>
        <span className="shrink-0 text-[9px] uppercase tracking-wider">
          {LIVE_WEATHER_PANEL.label}
        </span>
        <LiveWeatherFrameIndicator variant="panel" />
        <span className="ml-auto shrink-0 text-[10px]">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div
          id="live-weather-map-panel"
          className={clsx("px-1.5 pb-1.5", !map && "opacity-60")}
        >
          <SatelliteRadarPanel map={map} />
        </div>
      )}
    </div>
  );
}
