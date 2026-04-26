"use client";

import type { Map as MLMap } from "maplibre-gl";
import type { PanelId } from "@/config/panels";

/**
 * Encode the map viewport and open panels to URL hash for shareable links.
 * Format: #v=lng,lat,zoom&p=hazard,alerts
 */

type UrlState = {
  viewport: { lng: number; lat: number; zoom: number } | null;
  panels: PanelId[] | null;
  mode: "2d" | "3d" | null;
};

export function readUrlState(): UrlState {
  if (typeof window === "undefined") return { viewport: null, panels: null, mode: null };
  const hash = window.location.hash.slice(1);
  if (!hash) return { viewport: null, panels: null, mode: null };
  const params = new URLSearchParams(hash);
  let viewport: UrlState["viewport"] = null;
  const v = params.get("v");
  if (v) {
    const [lngS, latS, zS] = v.split(",");
    const lng = Number(lngS);
    const lat = Number(latS);
    const zoom = Number(zS);
    if ([lng, lat, zoom].every(Number.isFinite)) {
      viewport = { lng, lat, zoom };
    }
  }
  const p = params.get("p");
  const panels = p ? (p.split(",").filter(Boolean) as PanelId[]) : null;
  const m = params.get("m");
  const mode = m === "3d" ? "3d" : m === "2d" ? "2d" : null;
  return { viewport, panels, mode };
}

export function writeUrlState(state: Partial<UrlState>) {
  if (typeof window === "undefined") return;
  const current = readUrlState();
  const next: UrlState = { ...current, ...state };
  const params = new URLSearchParams();
  if (next.viewport) {
    const { lng, lat, zoom } = next.viewport;
    params.set(
      "v",
      `${lng.toFixed(3)},${lat.toFixed(3)},${zoom.toFixed(2)}`,
    );
  }
  if (next.panels && next.panels.length) {
    params.set("p", next.panels.join(","));
  }
  if (next.mode) {
    params.set("m", next.mode);
  }
  const hash = params.toString();
  const newUrl = `${window.location.pathname}${window.location.search}${hash ? "#" + hash : ""}`;
  window.history.replaceState(null, "", newUrl);
}

/**
 * Wire the map's `moveend` event to the URL hash (debounced). Returns a
 * disposer that removes the listener and clears any pending debounce timer —
 * call it on map unmount to avoid stacking handlers across remounts.
 */
export function attachMapUrlSync(map: MLMap): () => void {
  let timeout: number | null = null;
  const onMove = () => {
    if (timeout) window.clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      const c = map.getCenter();
      writeUrlState({
        viewport: { lng: c.lng, lat: c.lat, zoom: map.getZoom() },
      });
    }, 300);
  };
  map.on("moveend", onMove);
  const initial = readUrlState();
  if (initial.viewport) {
    map.jumpTo({
      center: [initial.viewport.lng, initial.viewport.lat],
      zoom: initial.viewport.zoom,
    });
  }
  const dispose = () => {
    if (timeout) window.clearTimeout(timeout);
    map.off("moveend", onMove);
  };
  // Auto-clean when the map itself is destroyed, in case the caller forgets
  // to invoke the returned disposer. Guarded so tests with minimal map
  // stubs don't blow up on a missing `once`.
  if (typeof map.once === "function") {
    map.once("remove", dispose);
  }
  return dispose;
}
