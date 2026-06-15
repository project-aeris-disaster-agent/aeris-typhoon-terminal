"use client";

import { clsx } from "clsx";
import type { MapMode } from "./MapContainer";
import { HelpHint } from "@/components/ui/HelpTooltip";

export function MapModeToggle({
  mode,
  onChange,
  onOpenPanahon,
  onOpenNoah,
  allow3d = true,
}: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
  onOpenPanahon?: () => void;
  onOpenNoah?: () => void;
  /** When false (mobile/touch devices), the 3D mode button is hidden. */
  allow3d?: boolean;
}) {
  const MODE_META: Record<MapMode, { label: string; hint: string }> = {
    "2d": { label: "2D", hint: "Analytical" },
    "3d": { label: "3D", hint: "Immersive" },
  };
  const modes: readonly MapMode[] = allow3d ? ["2d", "3d"] : ["2d"];

  return (
    <div className="panel-glass rounded-md p-0.5 font-mono text-body-sm">
      <div className="mb-0.5 flex items-center gap-1 px-1.5 text-chrome uppercase tracking-wider text-aeris-muted">
        <span>View Mode</span>
        <HelpHint helpId="control.viewMode" side="right" />
        {(onOpenPanahon || onOpenNoah) && (
          <HelpHint helpId="control.externalMaps" side="right" />
        )}
      </div>
      <div className="flex items-stretch">
        {modes.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={clsx(
              "px-2.5 py-1 rounded transition-colors uppercase tracking-wider text-left",
              mode === m
                ? "bg-aeris-accent/15 text-aeris-accent"
                : "text-aeris-muted hover:text-aeris-text",
            )}
            aria-pressed={mode === m}
            title={MODE_META[m].hint}
          >
            <span className="block leading-none">{MODE_META[m].label}</span>
            <span className="block text-chrome normal-case tracking-normal opacity-80">
              {MODE_META[m].hint}
            </span>
          </button>
        ))}
        {onOpenPanahon && (
          <button
            type="button"
            onClick={onOpenPanahon}
            className="px-2.5 py-1 rounded transition-colors uppercase tracking-wider text-left text-aeris-muted hover:bg-aeris-accent/10 hover:text-aeris-accent"
            title="Open PAGASA PANaHON nationwide hydromet map"
          >
            <span className="block leading-none">PAGASA</span>
            <span className="block text-chrome normal-case tracking-normal opacity-80">
              PANaHON ↗
            </span>
          </button>
        )}
        {onOpenNoah && (
          <button
            type="button"
            onClick={onOpenNoah}
            className="px-2.5 py-1 rounded transition-colors uppercase tracking-wider text-left text-aeris-muted hover:bg-aeris-accent/10 hover:text-aeris-accent"
            title="Open UP NOAH rainfall contour map"
          >
            <span className="block leading-none">NOAH</span>
            <span className="block text-chrome normal-case tracking-normal opacity-80">
              Rainfall ↗
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
