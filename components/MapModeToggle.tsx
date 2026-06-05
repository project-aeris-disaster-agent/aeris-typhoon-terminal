"use client";

import { clsx } from "clsx";
import type { MapMode } from "./MapContainer";

export function MapModeToggle({
  mode,
  onChange,
  onOpenPanahon,
  onOpenNoah,
}: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
  onOpenPanahon?: () => void;
  onOpenNoah?: () => void;
}) {
  const MODE_META: Record<MapMode, { label: string; hint: string }> = {
    "2d": { label: "2D", hint: "Analytical" },
    "3d": { label: "3D", hint: "Immersive" },
  };

  return (
    <div className="panel-glass rounded-md p-0.5 font-mono text-[11px]">
      <div className="mb-0.5 px-1.5 text-[9px] uppercase tracking-wider text-aeris-muted">
        View Mode
      </div>
      <div className="flex items-stretch">
        {(["2d", "3d"] as const).map((m) => (
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
            <span className="block text-[9px] normal-case tracking-normal opacity-80">
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
            <span className="block text-[9px] normal-case tracking-normal opacity-80">
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
            <span className="block text-[9px] normal-case tracking-normal opacity-80">
              Rainfall ↗
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
