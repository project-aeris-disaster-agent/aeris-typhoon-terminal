"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MLMap, LngLatLike } from "maplibre-gl";
import {
  PH_CENTER,
  PH_MAX_BOUNDS,
  DEFAULT_ZOOM,
  MIN_ZOOM,
  MAX_ZOOM,
} from "@/config/region";
import { getBasemapStyleUrl } from "@/config/basemap-style";
import { ensureBasemapOverlays } from "@/services/map-basemap";
import { reattachMapOverlaysAfterStyleChange } from "@/services/map-style-reattach";
import type { MapMode } from "./MapContainer";
import { applyMapViewMode } from "@/services/map-scene";

export type Map2DProps = {
  mode: MapMode;
  theme: "light" | "dark";
  onReady?: (map: MLMap) => void;
  className?: string;
};

/**
 * Region-locked MapLibre GL map for the Philippines. Pan/zoom is constrained
 * via `maxBounds` so users cannot navigate outside the archipelago.
 */
export function Map2D({ mode, theme, onReady, className }: Map2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const mapReadyRef = useRef(false);
  const appliedThemeRef = useRef<"light" | "dark" | null>(null);
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getBasemapStyleUrl(themeRef.current),
      center: PH_CENTER as LngLatLike,
      zoom: DEFAULT_ZOOM,
      pitch: 0,
      bearing: 0,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: PH_MAX_BOUNDS,
      attributionControl: false,
      renderWorldCopies: false,
      dragRotate: true,
      pitchWithRotate: true,
    });

    map.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

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

    map.on("load", () => {
      ensureBasemapOverlays(map, themeRef.current);
      mapRef.current = map;
      mapReadyRef.current = true;
      appliedThemeRef.current = themeRef.current;
      onReadyRef.current?.(map);
      applyMapViewMode(map, modeRef.current);
      requestAnimationFrame(resizeMap);
    });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => resizeMap())
        : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro?.disconnect();
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    applyMapViewMode(mapRef.current, mode);
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    if (appliedThemeRef.current === theme) return;

    map.setStyle(getBasemapStyleUrl(theme));
    map.once("style.load", () => {
      appliedThemeRef.current = theme;
      void reattachMapOverlaysAfterStyleChange(map, {
        theme,
        mode: modeRef.current,
      }).finally(() => {
        requestAnimationFrame(() => {
          map.resize();
          map.triggerRepaint();
        });
      });
    });
  }, [theme]);

  return <div ref={containerRef} className={className ?? "w-full h-full"} />;
}
