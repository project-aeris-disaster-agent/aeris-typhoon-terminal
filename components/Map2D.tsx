"use client";

import { useCallback, useEffect, useRef } from "react";
import maplibregl, { Map as MLMap, LngLatLike } from "maplibre-gl";
import {
  PH_CENTER,
  MAP_2D_MAX_BOUNDS,
  MAP_2D_MIN_ZOOM,
  DEFAULT_ZOOM,
  MAX_ZOOM,
} from "@/config/region";
import { getBasemapStyleUrl, type BasemapTheme } from "@/config/basemap-style";
import { ensureBasemapOverlays } from "@/services/map-basemap";
import { reattachMapOverlaysAfterStyleChange } from "@/services/map-style-reattach";
import type { MapMode } from "./MapContainer";
import { applyMapViewMode } from "@/services/map-scene";
import { detectDeviceTier, mapDprCapForTier } from "@/lib/device-tier";

export type Map2DProps = {
  mode: MapMode;
  theme: BasemapTheme;
  onReady?: (map: MLMap) => void;
  className?: string;
};

/**
 * Region-locked MapLibre GL map for the Philippines. In 2D, pan/zoom extends
 * to the full PAR and nearby WESTPAC monitor area; 3D uses tighter PH bounds.
 */
export function Map2D({ mode, theme, onReady, className }: Map2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mapReadyRef = useRef(false);
  /** Last basemap style URL successfully applied (not just requested). */
  const appliedBasemapUrlRef = useRef<string | null>(null);
  const themeSyncGenerationRef = useRef(0);
  const onReadyRef = useRef(onReady);
  const modeRef = useRef(mode);
  const themeRef = useRef(theme);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const applyBasemapTheme = useCallback(
    (map: MLMap, nextTheme: BasemapTheme, onComplete?: () => void) => {
      const styleUrl = getBasemapStyleUrl(nextTheme);

      const runComplete = () => {
        if (themeRef.current !== nextTheme) {
          applyBasemapTheme(map, themeRef.current, onComplete);
          return;
        }
        onComplete?.();
      };

      const finishApply = () => {
        appliedBasemapUrlRef.current = styleUrl;
        ensureBasemapOverlays(map, nextTheme);
        void reattachMapOverlaysAfterStyleChange(map, {
          theme: nextTheme,
          mode: modeRef.current,
        }).finally(() => {
          requestAnimationFrame(() => {
            map.resize();
            map.triggerRepaint();
            runComplete();
          });
        });
      };

      if (appliedBasemapUrlRef.current === styleUrl) {
        ensureBasemapOverlays(map, nextTheme);
        runComplete();
        return;
      }

      const generation = ++themeSyncGenerationRef.current;
      map.setStyle(styleUrl);
      map.once("style.load", () => {
        if (generation !== themeSyncGenerationRef.current) return;
        finishApply();
      });
    },
    [],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialTheme = themeRef.current;
    const initialStyleUrl = getBasemapStyleUrl(initialTheme);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyleUrl,
      center: PH_CENTER as LngLatLike,
      zoom: DEFAULT_ZOOM,
      pitch: 0,
      bearing: 0,
      minZoom: MAP_2D_MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: MAP_2D_MAX_BOUNDS,
      attributionControl: false,
      renderWorldCopies: false,
      dragRotate: true,
      pitchWithRotate: true,
    });

    const tier = detectDeviceTier();
    map.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, mapDprCapForTier(tier)),
    );

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    const resizeMap = () => {
      map.resize();
      map.triggerRepaint();
    };

    // Mobile browsers (iOS Safari / Android Chrome) collapse the URL bar
    // shortly after first paint, which changes the actual visible viewport
    // height without firing a normal `resize` event on the map container.
    // We listen to `visualViewport` + `orientationchange` and re-run a few
    // delayed `map.resize()` passes so the WebGL canvas always matches the
    // container's real on-screen size.
    const scheduleDeferredResizes = () => {
      [0, 60, 200, 500, 1000].forEach((delay) => {
        setTimeout(() => {
          if (!mapRef.current) return;
          resizeMap();
        }, delay);
      });
    };

    const onVisualViewportChange = () => scheduleDeferredResizes();
    const onOrientationChange = () => scheduleDeferredResizes();
    const onWindowResize = () => resizeMap();
    if (typeof window !== "undefined") {
      window.addEventListener("orientationchange", onOrientationChange);
      window.addEventListener("resize", onWindowResize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", onVisualViewportChange);
        window.visualViewport.addEventListener("scroll", onVisualViewportChange);
      }
    }

    map.on("load", () => {
      mapRef.current = map;
      mapReadyRef.current = true;

      const finishReady = () => {
        onReadyRef.current?.(map);
        applyMapViewMode(map, modeRef.current);
        requestAnimationFrame(resizeMap);
        // Mobile browsers settle layout (URL bar collapse, ad image load,
        // dvh recalculation) over the first ~1s. Re-run resize on a short
        // ladder so the canvas latches onto the final visible viewport.
        scheduleDeferredResizes();
      };

      const desiredTheme = themeRef.current;
      const desiredUrl = getBasemapStyleUrl(desiredTheme);

      if (initialStyleUrl === desiredUrl) {
        appliedBasemapUrlRef.current = desiredUrl;
        ensureBasemapOverlays(map, desiredTheme);
        finishReady();
        return;
      }

      applyBasemapTheme(map, desiredTheme, finishReady);
    });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => resizeMap())
        : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro?.disconnect();
      if (typeof window !== "undefined") {
        window.removeEventListener("orientationchange", onOrientationChange);
        window.removeEventListener("resize", onWindowResize);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener("resize", onVisualViewportChange);
          window.visualViewport.removeEventListener("scroll", onVisualViewportChange);
        }
      }
      mapReadyRef.current = false;
      appliedBasemapUrlRef.current = null;
      themeSyncGenerationRef.current += 1;
      map.remove();
      mapRef.current = null;
    };
  }, [applyBasemapTheme]);

  useEffect(() => {
    if (!mapRef.current) return;
    applyMapViewMode(mapRef.current, mode);
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyBasemapTheme(map, theme);
  }, [theme, applyBasemapTheme]);

  return <div ref={containerRef} className={className ?? "w-full h-full"} />;
}
