"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Map as MLMap, LngLatLike } from "maplibre-gl";
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
import {
  DEVICE_TIER,
  detectDeviceTier,
  isCoarsePointerDevice,
} from "@/lib/device-tier";
import { readStoredTheme } from "@/lib/theme-storage";
import { detectWebglSupport } from "@/lib/webgl-support";
import { configureMaplibreWorker } from "@/lib/maplibre-worker";

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
  /**
   * Completion callbacks for in-flight theme swaps. Stored on a shared ref so
   * a swap superseded by a newer theme write (generation mismatch) never drops
   * its `onComplete` — the winning swap drains every pending callback. The
   * initial `finishReady` (-> `onReady`) rides this path, so losing it meant
   * overlays never initialized on first load.
   */
  const pendingThemeCompletionsRef = useRef<Array<() => void>>([]);
  const onReadyRef = useRef(onReady);
  const modeRef = useRef(mode);
  const themeRef = useRef(theme);
  /**
   * Set when WebGL is unavailable or MapLibre's constructor throws. The map
   * then renders an explanation in place of the canvas instead of letting the
   * throw escape render and take the whole terminal down with it.
   */
  const [renderFailure, setRenderFailure] = useState<string | null>(null);

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
      if (onComplete) pendingThemeCompletionsRef.current.push(onComplete);

      const runComplete = () => {
        if (themeRef.current !== nextTheme) {
          // Pending completions stay queued; the follow-up swap drains them.
          applyBasemapTheme(map, themeRef.current);
          return;
        }
        for (const cb of pendingThemeCompletionsRef.current.splice(0)) cb();
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
      // `diff: false` forces a full style rebuild. With the default diff,
      // MapLibre patches positron -> dark-matter in place via `setState`,
      // which never fires `style.load`: the re-attach below never ran, so a
      // theme toggle wiped report pings, flood, PAR and radar, and left the
      // old sprite behind on the way back.
      map.setStyle(styleUrl, { diff: false });
      map.once("style.load", () => {
        if (generation !== themeSyncGenerationRef.current) return;
        finishApply();
      });
    },
    [],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Resolve the theme synchronously from storage instead of trusting the
    // `theme` prop: ThemeProvider hydrates the stored theme in an effect that
    // runs AFTER this one, so the prop still holds the SSR default ("light")
    // here. Creating the map with the wrong style forced a `setStyle()` swap
    // at load time that raced overlay layer-adds and wiped them (report
    // pings / satellite missing until a manual theme toggle).
    const initialTheme = readStoredTheme();
    themeRef.current = initialTheme;
    const initialStyleUrl = getBasemapStyleUrl(initialTheme);

    /**
     * MapLibre throws synchronously from `new Map()` when it cannot get a
     * WebGL context. Unguarded, that throw escaped this effect and React tore
     * the whole tree down — the alerts feed, live reports, typhoon bulletins
     * and news died along with the map, leaving only "Application error: a
     * client-side exception has occurred".
     *
     * Probe first, and still wrap the constructor: the probe can succeed and
     * the real context creation fail anyway (context limits, driver resets).
     * Either way the failure stays inside this panel.
     */
    if (detectWebglSupport() === "unavailable") {
      setRenderFailure(
        "This browser can't start WebGL, which the map needs. Turn on hardware acceleration in your browser settings, then reload.",
      );
      return;
    }

    configureMaplibreWorker();

    let map: MLMap;
    try {
      map = new maplibregl.Map({
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
    } catch (error) {
      console.error("[map2d] MapLibre failed to initialize", error);
      setRenderFailure(
        "The map could not start on this device. Every other panel still works; reload to try again.",
      );
      return;
    }

    const tier = detectDeviceTier();
    map.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, DEVICE_TIER[tier].mapDpr),
    );

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    // Touch devices (phones and tablets) already have pinch-to-zoom, so the
    // on-screen +/- buttons are redundant chrome that eats map space.
    if (!isCoarsePointerDevice()) {
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
    }
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    // Resize passes are cheap-gated: skip `map.resize()` + `triggerRepaint()`
    // entirely when the container's on-screen size (and DPR) hasn't actually
    // changed, so the deferred ladders below don't burn GPU frames for no-ops.
    let lastResizeW = -1;
    let lastResizeH = -1;
    let lastResizeDpr = -1;
    const resizeMap = () => {
      const container = containerRef.current;
      if (container) {
        const w = container.clientWidth;
        const h = container.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        if (w === lastResizeW && h === lastResizeH && dpr === lastResizeDpr) {
          return;
        }
        lastResizeW = w;
        lastResizeH = h;
        lastResizeDpr = dpr;
      }
      map.resize();
      map.triggerRepaint();
    };

    // Mobile browsers (iOS Safari / Android Chrome) collapse the URL bar
    // shortly after first paint, which changes the actual visible viewport
    // height without firing a normal `resize` event on the map container.
    // We listen to `visualViewport` + `orientationchange` and re-run a few
    // delayed `map.resize()` passes so the WebGL canvas always matches the
    // container's real on-screen size. Re-invocations cancel the previous
    // ladder so rapid viewport events coalesce into a single schedule.
    let deferredResizeTimers: number[] = [];
    const scheduleDeferredResizes = () => {
      for (const id of deferredResizeTimers) window.clearTimeout(id);
      deferredResizeTimers = [0, 150, 500, 1000].map((delay) =>
        window.setTimeout(() => {
          if (!mapRef.current) return;
          resizeMap();
        }, delay),
      );
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
      for (const id of deferredResizeTimers) window.clearTimeout(id);
      deferredResizeTimers = [];
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
      pendingThemeCompletionsRef.current = [];
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

  if (renderFailure) {
    return (
      <div
        ref={containerRef}
        className={`${className ?? "w-full h-full"} flex items-center justify-center bg-aeris-bg p-6`}
        role="status"
      >
        <div className="max-w-sm space-y-2 text-center">
          <p className="chrome-label text-aeris-warn">MAP UNAVAILABLE</p>
          <p className="text-body-sm leading-snug text-aeris-muted">
            {renderFailure}
          </p>
          <p className="text-body-sm leading-snug text-aeris-muted/80">
            Alerts, live reports, typhoon bulletins, forecast, and news are
            unaffected.
          </p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={className ?? "w-full h-full"} />;
}
