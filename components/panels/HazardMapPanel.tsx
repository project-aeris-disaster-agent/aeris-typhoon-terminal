"use client";

import { useEffect, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { CardHeader, Pill } from "../ui/Card";
import {
  FLOOD_LEVEL_STYLE,
  ensureFloodHazardLayers,
  formatReturnPeriodLabel,
  getFloodReturnPeriods,
  type FloodHazardPack,
} from "@/services/hazard-layers";

export function HazardMapPanel({ map }: { map: MLMap | null }) {
  const [packs, setPacks] = useState<FloodHazardPack[]>([]);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    ensureFloodHazardLayers(map).then((next) => {
      if (!cancelled) setPacks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [map]);

  const periods = getFloodReturnPeriods(packs);

  return (
    <div className="space-y-2">
      <CardHeader
        title="Flood Hazard"
        trailing={<Pill tone="accent">MGB Flo-2D</Pill>}
      />
      <p className="text-xs text-aeris-muted">
        Select a return period from the Layers control (top-left) to tint
        flood-susceptible areas. In 3D mode, buildings and roads inside the
        flood polygons light up with the same palette so you can scan
        affected structures at a glance.
      </p>

      <div className="space-y-1">
        <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
          Susceptibility legend
        </div>
        {(["high", "medium", "low"] as const).map((level) => (
          <div
            key={level}
            className="flex items-center gap-2 text-xs text-aeris-text/90"
          >
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: FLOOD_LEVEL_STYLE[level].color }}
            />
            <span className="flex-1">{FLOOD_LEVEL_STYLE[level].label}</span>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <div className="text-[10px] text-aeris-muted uppercase tracking-wider">
          Loaded packs ({packs.length})
        </div>
        {packs.length === 0 ? (
          <div className="text-[11px] text-aeris-muted italic">
            No flood packs registered yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {periods.map((period) => {
              const provinces = packs
                .filter((p) => p.returnPeriod === period)
                .map((p) => p.province);
              return (
                <li
                  key={period}
                  className="flex items-center gap-2 text-[11px] text-aeris-text/90"
                >
                  <span className="font-medium">
                    {formatReturnPeriodLabel(period)}
                  </span>
                  <span className="text-aeris-muted flex-1 truncate">
                    {provinces.join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="text-[10px] text-aeris-muted pt-1">
        Data: Mines & Geosciences Bureau (DENR) Flo-2D flood-hazard maps.
      </div>
    </div>
  );
}
