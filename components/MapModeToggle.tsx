"use client";

import { clsx } from "clsx";
import type { MapMode } from "./MapContainer";
import { HelpHint } from "@/components/ui/HelpTooltip";

export function MapModeToggle({
  mode,
  onChange,
  onOpenPanahon,
  allow3d = true,
}: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
  onOpenPanahon?: () => void;
  /** When false (mobile/touch devices), the 3D mode button is hidden. */
  allow3d?: boolean;
}) {
  const MODE_META: Record<MapMode, { label: string; hint: string }> = {
    "2d": { label: "2D", hint: "Analytical" },
    "3d": { label: "3D", hint: "Immersive" },
  };
  const modes: readonly MapMode[] = allow3d ? ["2d", "3d"] : ["2d"];

  // FLOOD CONTROL segmented track (landing `.lp-tabs`): pale track, white
  // raised segment for the active mode; PAGASA is an outbound link, so it sits
  // beside the track as a ghost button rather than pretending to be a mode.
  return (
    <div className="panel-glass rounded-xl p-2">
      <div className="aeris-label mb-1.5 flex items-center gap-1 px-0.5">
        <span>View mode</span>
        <HelpHint helpId="control.viewMode" side="right" />
        {onOpenPanahon && (
          <HelpHint helpId="control.externalMaps" side="right" />
        )}
      </div>
      <div className="flex items-stretch gap-1.5">
        <div className="aeris-seg flex-1" role="group" aria-label="Map view mode">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange(m)}
              className="aeris-seg-btn px-2.5 py-1 text-left"
              aria-pressed={mode === m}
              title={MODE_META[m].hint}
            >
              <span className="block text-body-sm font-black leading-tight">
                {MODE_META[m].label}
              </span>
              <span className="block text-[0.6875rem] font-bold leading-tight opacity-75">
                {MODE_META[m].hint}
              </span>
            </button>
          ))}
        </div>
        {onOpenPanahon && (
          <button
            type="button"
            onClick={onOpenPanahon}
            className={clsx("aeris-btn-ghost !rounded-xl px-2.5 py-1 text-left")}
            title="Open PAGASA PANaHON nationwide hydromet map"
          >
            <span>
              <span className="block text-body-sm font-black leading-tight">PAGASA</span>
              <span className="block text-[0.6875rem] font-bold leading-tight opacity-80">
                PANaHON ↗
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
