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
import { LiveWeatherMapPanel } from "./LiveWeatherMapPanel";
import { MapModeToggle } from "./MapModeToggle";
import { ExternalMapFrame } from "./ExternalMapFrame";
import {
  EXTERNAL_MAP_FRAMES,
  type ExternalMapFrameId,
} from "@/config/external-map-frames";
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
} from "@/services/live-weather-overlay";
import {
  setReportPingLoopActive,
  setReportPingPerformanceMode,
} from "@/services/reports-client";
import {
  applyDeviceTierToMap,
  detectDeviceTier,
  isCoarsePointerDevice,
  mapModeFromUrl,
  DEVICE_TIER,
} from "@/lib/device-tier";
import { DataLoadingPopup } from "@/components/ui/DataLoadingPopup";
import { useTheme } from "@/components/providers/ThemeProvider";

export type MapMode = "2d" | "3d";

export type MapContainerProps = {
  onMapReady?: (map: MLMap) => void;
  mapOverlay?: ReactNode;
  layoutActive?: boolean;
};

export const MapContainer = memo(function MapContainer({
  onMapReady,
  mapOverlay,
  layoutActive = true,
}: MapContainerProps) {
  const { theme, setTheme } = useTheme();
  const themeUrlSyncedRef = useRef(false);
  const [mode, setMode] = useState<MapMode>("2d");
  // 3D mode is fully disabled on mobile/touch devices — terrain + Three.js
  // are too heavy for phone GPUs/batteries. Resolved in an effect (not a
  // lazy initializer) so SSR markup stays consistent with hydration.
  const [allow3d, setAllow3d] = useState(true);
  const [externalFrame, setExternalFrame] = useState<ExternalMapFrameId | null>(
    null,
  );
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

  const handleModeChange = useCallback((next: MapMode) => {
    if (next === "3d" && isCoarsePointerDevice()) return;
    setMode(next);
  }, []);

  useEffect(() => {
    if (!isCoarsePointerDevice()) return;
    setAllow3d(false);
    // Force back to 2D in case 3D was already active (e.g. desktop responsive
    // emulation or a device-mode change mid-session).
    setMode((current) => (current === "3d" ? "2d" : current));
  }, []);

  useEffect(() => {
    const initial = readUrlState();
    const urlMode = mapModeFromUrl(initial.mode);
    if (urlMode && urlMode !== mode) setMode(urlMode);
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
    setReportPingPerformanceMode(map, DEVICE_TIER[tier].profile);
    setSceneAnimationsEnabled(map, false);
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const sync = () => {
      const active = layoutActive && !document.hidden;
      setLiveWeatherOverlayActive(map, active);
      setReportPingLoopActive(map, active);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [map, layoutActive]);

  useEffect(() => {
    if (!map || !layoutActive) return;
    // One immediate pass once layout settles, plus a single delayed pass to
    // catch late flex/panel transitions. (Map2D's resize handlers already
    // no-op when the canvas size is unchanged.)
    const rafId = requestAnimationFrame(() => {
      map.resize();
      map.triggerRepaint();
    });
    const timeoutId = window.setTimeout(() => {
      map.resize();
      map.triggerRepaint();
    }, 300);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
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
        <LiveWeatherMapPanel map={map} />
        <MapModeToggle
          mode={mode}
          onChange={handleModeChange}
          onOpenPanahon={() => setExternalFrame("panahon")}
          onOpenNoah={() => setExternalFrame("noah")}
          allow3d={allow3d}
        />
        <div className="hidden md:flex flex-col gap-2">
          <QuickViewsPanel map={map} mode={mode} />
          <LayerLegend map={map} mode={mode} />
        </div>
      </div>
      <ExternalMapFrame
        open={externalFrame !== null}
        onClose={() => setExternalFrame(null)}
        config={externalFrame ? EXTERNAL_MAP_FRAMES[externalFrame] : null}
      />
    </div>
  );
});
