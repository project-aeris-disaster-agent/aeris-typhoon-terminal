"use client";

import { clsx } from "clsx";
import type { MapMode } from "./MapContainer";

export function MapModeToggle({
  mode,
  onChange,
}: {
  mode: MapMode;
  onChange: (m: MapMode) => void;
}) {
  return (
    <div className="panel-glass rounded-md flex items-center p-0.5 font-mono text-[11px]">
      {(["2d", "3d"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={clsx(
            "px-2.5 py-1 rounded transition-colors uppercase tracking-wider",
            mode === m
              ? "bg-aeris-accent/15 text-aeris-accent"
              : "text-aeris-muted hover:text-aeris-text",
          )}
          aria-pressed={mode === m}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
