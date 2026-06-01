"use client";

import {
  memo,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { Map as MLMap } from "maplibre-gl";
import { Map2D } from "./Map2D";
import { MapModeToggle } from "./MapModeToggle";
import { LayerLegend, QuickViewsPanel } from "./LayerLegend";
import { readUrlState, writeUrlState } from "@/services/url-state";
import {
  setMapSceneTheme,
  setSceneAnimationsEnabled,
  subscribeSceneLoading,
} from "@/services/map-scene";
import {
  applyLiveWeatherDeviceTier,
  setLiveWeatherOverlayActive,
  setLiveWeatherPerformanceProfile,
} from "@/services/live-weather-overlay";
import {
  setReportPingLoopActive,
  setReportPingPerformanceMode,
} from "@/services/reports-client";
import {
  applyDeviceTierToMap,
  detectDeviceTier,
  isCoarsePointerDevice,
  liveWeatherProfileForTier,
  reportPingProfileForTier,
} from "@/lib/device-tier";
import { DataLoadingPopup } from "@/components/ui/DataLoadingPopup";
import { useTheme } from "@/components/providers/ThemeProvider";

export type MapMode = "2d" | "3d";

export type MapContainerProps = {
  onMapReady?: (map: MLMap) => void;
  /** Rendered inside the map frame (e.g. overlays anchored to the map area). */
  mapOverlay?: ReactNode;
  /** When false (e.g. mobile Reports tab), map stays mounted but parent is hidden — resize when true again. */
  layoutActive?: boolean;
};

/**
 * Hosts a single MapLibre map that can be switched between 2D and 3D terrain
 * modes without tearing down the active map session.
 */
export const MapContainer = memo(function MapContainer({
  onMapReady,
  mapOverlay,
  layoutActive = true,
}: MapContainerProps) {
  const { theme, setTheme } = useTheme();
  const themeUrlSyncedRef = useRef(false);
  const [mode, setMode] = useState<MapMode>("2d");
  const [mobile3dUnlocked, setMobile3dUnlocked] = useState(false);
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
  const handleModeChange = useCallback((next: MapMode) => {
    if (
      next === "3d" &&
      isCoarsePointerDevice() &&
      !mobile3dUnlocked
    ) {
      const ok = window.confirm(
        "3D mode uses more GPU and battery on mobile. Enable immersive 3D view?",
      );
      if (!ok) return;
      setMobile3dUnlocked(true);
    }
    setMode(next);
  }, [mobile3dUnlocked]);

  useEffect(() => {
    const initial = readUrlState();
    if (initial.mode && initial.mode !== mode) {
      if (initial.mode === "3d" && isCoarsePointerDevice()) {
        /* Mobile stays 2D until the user confirms via MapModeToggle. */
      } else {
        setMode(initial.mode);
      }
    }
    if (initial.theme) {
      if (initial.theme !== theme) setTheme(initial.theme);
    } else {
      writeUrlState({ theme });
    }
    themeUrlSyncedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeUrlState({ mode });
  }, [mode]);

  useEffect(() => {
    if (!themeUrlSyncedRef.current) return;
    writeUrlState({ theme });
  }, [theme]);

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

  useEffect(() => {
    if (!map) return;
    const tier = detectDeviceTier();
    applyDeviceTierToMap(map, tier);
    applyLiveWeatherDeviceTier(map, tier);
    setLiveWeatherPerformanceProfile(map, liveWeatherProfileForTier(tier));
    setReportPingPerformanceMode(map, reportPingProfileForTier(tier));
    setSceneAnimationsEnabled(map, false);
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const syncOverlayLoops = () => {
      const active = layoutActive && !document.hidden;
      setLiveWeatherOverlayActive(map, active);
      setReportPingLoopActive(map, active);
    };
    syncOverlayLoops();
    document.addEventListener("visibilitychange", syncOverlayLoops);
    return () => document.removeEventListener("visibilitychange", syncOverlayLoops);
  }, [map, layoutActive]);

  useEffect(() => {
    if (!map || !layoutActive) return;
    const rafId = requestAnimationFrame(() => {
      map.resize();
      map.triggerRepaint();
    });
    // Mobile: when the tab flips back to the map slot, the visible viewport
    // may take an extra frame or two to settle (URL bar, keyboard dismiss).
    // A short ladder of follow-up resizes guarantees the canvas matches the
    // final container size without depending on ResizeObserver microtiming.
    const timeoutIds = [120, 360].map((delay) =>
      window.setTimeout(() => {
        map.resize();
        map.triggerRepaint();
      }, delay),
    );
    return () => {
      cancelAnimationFrame(rafId);
      timeoutIds.forEach((id) => window.clearTimeout(id));
    };
  }, [map, layoutActive]);

  return (
    <div className="relative w-full h-full bg-aeris-bg">
      <Map2D mode={mode} theme={theme} onReady={handleReady} />
      {mapOverlay}
      <DataLoadingPopup
        active={showLoadingPopup}
        blocking
        message={loadingMessage}
      />

      <div className="absolute z-10 flex flex-col gap-2 top-3 left-3 max-md:bottom-[4.25rem] max-md:top-auto max-md:left-3 max-md:right-auto">
        <MapModeToggle mode={mode} onChange={handleModeChange} />
        <div className="hidden md:flex flex-col gap-2">
          <QuickViewsPanel map={map} mode={mode} />
          <LayerLegend map={map} mode={mode} />
        </div>
      </div>
    </div>
  );
});
