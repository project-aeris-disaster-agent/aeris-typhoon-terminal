"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { Map2D } from "./Map2D";
import { MapModeToggle } from "./MapModeToggle";
import { LayerLegend, QuickViewsPanel } from "./LayerLegend";
import { readUrlState, writeUrlState } from "@/services/url-state";
import { setMapSceneTheme, subscribeSceneLoading } from "@/services/map-scene";
import { DataLoadingPopup } from "@/components/ui/DataLoadingPopup";
import { useTheme } from "@/components/providers/ThemeProvider";

export type MapMode = "2d" | "3d";

export type MapContainerProps = {
  onMapReady?: (map: MLMap) => void;
  /** Rendered inside the map frame (e.g. overlays anchored to the map area). */
  mapOverlay?: ReactNode;
};

/**
 * Hosts a single MapLibre map that can be switched between 2D and 3D terrain
 * modes without tearing down the active map session.
 */
export function MapContainer({ onMapReady, mapOverlay }: MapContainerProps) {
  const { theme } = useTheme();
  const [mode, setMode] = useState<MapMode>("2d");
  const [map, setMap] = useState<MLMap | null>(null);
  const [showLoadingPopup, setShowLoadingPopup] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Loading data, please wait...");
  const loadingRevealDelayMs = 900;

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

  useEffect(() => {
    if (!map) {
      setShowLoadingPopup(false);
      return;
    }
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeSceneLoading(
      map,
      ({ majorLoading, majorLoadingMessage }) => {
        setLoadingMessage(majorLoadingMessage ?? "Loading data, please wait...");
        if (majorLoading) {
          if (revealTimer) return;
          revealTimer = setTimeout(() => {
            revealTimer = null;
            setShowLoadingPopup(true);
          }, loadingRevealDelayMs);
          return;
        }

        if (revealTimer) {
          clearTimeout(revealTimer);
          revealTimer = null;
        }
        setShowLoadingPopup(false);
      },
    );
    return () => {
      if (revealTimer) clearTimeout(revealTimer);
      unsubscribe();
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (showLoadingPopup) {
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.doubleClickZoom.disable();
      map.keyboard.disable();
      map.touchZoomRotate.disable();
      map.dragRotate.disable();
      return;
    }

    map.dragPan.enable();
    map.scrollZoom.enable();
    map.boxZoom.enable();
    map.doubleClickZoom.enable();
    map.keyboard.enable();
    map.touchZoomRotate.enable();
    if (mode === "3d") {
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
    } else {
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
    }
  }, [map, mode, showLoadingPopup]);

  useEffect(() => {
    if (!map) return;
    setMapSceneTheme(map, theme);
  }, [map, theme]);

  return (
    <div className="relative w-full h-full bg-aeris-bg">
      <Map2D mode={mode} theme={theme} onReady={handleReady} />
      {mapOverlay}
      <DataLoadingPopup
        active={showLoadingPopup}
        blocking
        message={loadingMessage}
      />

      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        <MapModeToggle mode={mode} onChange={setMode} />
        {mode === "3d" && <QuickViewsPanel map={map} />}
        <LayerLegend map={map} mode={mode} />
      </div>
    </div>
  );
}
