"use client";

import { useState, useCallback, useEffect } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { Map2D } from "./Map2D";
import { MapModeToggle } from "./MapModeToggle";
import { LayerLegend } from "./LayerLegend";
import { readUrlState, writeUrlState } from "@/services/url-state";

export type MapMode = "2d" | "3d";

export type MapContainerProps = {
  onMapReady?: (map: MLMap) => void;
};

/**
 * Hosts a single MapLibre map that can be switched between 2D and 3D terrain
 * modes without tearing down the active map session.
 */
export function MapContainer({ onMapReady }: MapContainerProps) {
  const [mode, setMode] = useState<MapMode>("2d");
  const [map, setMap] = useState<MLMap | null>(null);

  const handleReady = useCallback(
    (m: MLMap) => {
      setMap(m);
      onMapReady?.(m);
    },
    [onMapReady],
  );

  // Read URL hash on the client after hydration so the initial SSR HTML
  // matches (server has no access to window.location.hash).
  useEffect(() => {
    const initial = readUrlState().mode;
    if (initial && initial !== mode) setMode(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeUrlState({ mode });
  }, [mode]);

  return (
    <div className="relative w-full h-full bg-aeris-bg">
      <Map2D mode={mode} onReady={handleReady} />

      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        <MapModeToggle mode={mode} onChange={setMode} />
        <LayerLegend map={map} mode={mode} />
      </div>
    </div>
  );
}
