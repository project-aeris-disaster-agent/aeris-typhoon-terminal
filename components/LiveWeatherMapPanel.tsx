"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Map as MLMap } from "maplibre-gl";
import { clsx } from "clsx";
import { LIVE_WEATHER_PANEL } from "@/config/panels";
import { PanelIcon } from "@/components/PanelIcon";
import { LiveWeatherFrameIndicator } from "@/components/LiveWeatherFrameHud";
import { PanelSkeleton } from "@/components/ui/PanelSkeleton";
import { shouldIgnoreHotkey } from "@/lib/hotkeys";
import { HotkeyCap } from "@/components/ui/Kit";
import { ChevronDown } from "lucide-react";

const SatelliteRadarPanel = dynamic(
  () =>
    import("./panels/SatelliteRadarPanel").then((m) => ({
      default: m.SatelliteRadarPanel,
    })),
  {
    ssr: false,
    loading: () => (
      <PanelSkeleton
        label="Loading radar…"
        className="h-12 rounded border border-aeris-border/80 bg-aeris-bg/40 px-2 text-body-sm"
      />
    ),
  },
);

export function LiveWeatherMapPanel({ map }: { map: MLMap | null }) {
  const [open, setOpen] = useState(LIVE_WEATHER_PANEL.defaultOpen);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreHotkey(e)) return;
      if (e.key === LIVE_WEATHER_PANEL.hotkey) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="panel-glass rounded-xl text-body-sm w-full max-w-[280px]">
      <button
        type="button"
        onClick={toggle}
        className="group w-full flex items-center gap-2 py-1.5 pl-1.5 pr-2.5 text-left"
        aria-expanded={open}
        aria-controls="live-weather-map-panel"
        title={`${LIVE_WEATHER_PANEL.label} (${LIVE_WEATHER_PANEL.hotkey})`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-aeris-kicker text-aeris-kicker-ink">
          <PanelIcon id="satellite" size={15} className="!text-current" />
        </span>
        <span className="aeris-title shrink-0 group-hover:text-aeris-accent">
          {LIVE_WEATHER_PANEL.label}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <LiveWeatherFrameIndicator variant="panel" />
        </span>
        <HotkeyCap className="shrink-0">{LIVE_WEATHER_PANEL.hotkey}</HotkeyCap>
        <ChevronDown
          size={16}
          aria-hidden
          className={clsx(
            "shrink-0 text-aeris-muted transition-transform group-hover:text-aeris-accent",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          id="live-weather-map-panel"
          className={clsx("mx-2 border-t border-aeris-border/70 pb-2 pt-2", !map && "opacity-60")}
        >
          <SatelliteRadarPanel map={map} />
        </div>
      )}
    </div>
  );
}
