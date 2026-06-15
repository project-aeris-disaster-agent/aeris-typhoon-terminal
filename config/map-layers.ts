import type { Map as MLMap } from "maplibre-gl";
import { CARTO_VECTOR_LABEL_ANCHOR_LAYER_ID } from "@/config/basemap-style";

/** Legacy raster basemap ids — kept for tests and satellite pin helpers. */
export const BASEMAP_BASE_SOURCE_ID = "osm";
export const BASEMAP_LABEL_SOURCE_ID = "osm-labels";
export const BASEMAP_BASE_LAYER_ID = "osm-base";
export const BASEMAP_LABEL_LAYER_ID = "osm-top-labels";
export const BASEMAP_MARKERS_LAYER_ID = "ph-major-city-dots";

/** Invisible top slot — dynamic markers insert immediately below this layer. */
export const AERIS_OVERLAY_TOP_LAYER_ID = "aeris-overlay-top";
export const AERIS_OVERLAY_ANCHOR_SOURCE_ID = "aeris-overlay-anchor";

export function resolveBasemapLabelAnchorLayer(map: MLMap): string | undefined {
  if (map.getLayer(BASEMAP_LABEL_LAYER_ID)) {
    return BASEMAP_LABEL_LAYER_ID;
  }
  if (map.getLayer(CARTO_VECTOR_LABEL_ANCHOR_LAYER_ID)) {
    return CARTO_VECTOR_LABEL_ANCHOR_LAYER_ID;
  }
  const style = map.getStyle();
  if (!style?.layers) return undefined;
  for (const layer of style.layers) {
    if (layer.type === "symbol") return layer.id;
  }
  return undefined;
}

/** Insert geography/context overlays below basemap labels. */
export function layerBeforeBasemapLabels(map: MLMap): string | undefined {
  return resolveBasemapLabelAnchorLayer(map);
}

/** Insert dynamic markers (reports, webcams, typhoon tracks) below the top slot. */
export function layerBeforeDynamicOverlays(map: MLMap): string | undefined {
  return map.getLayer(AERIS_OVERLAY_TOP_LAYER_ID)
    ? AERIS_OVERLAY_TOP_LAYER_ID
    : undefined;
}

/**
 * Run `fn` once the map's style can safely accept `addSource`/`addLayer`.
 *
 * Overlay renderers (report pings, webcams, water levels, satellite rasters)
 * can be invoked while a `map.setStyle()` swap is in flight — e.g. the
 * theme-correction swap during first load. Adding sources/layers against a
 * style that is not done loading either throws or gets silently wiped by the
 * incoming style, leaving overlays missing until the next poll. This helper
 * defers the add to the next `style.load` in that case.
 *
 * Falls through immediately when the map (e.g. a test stub) doesn't expose
 * `isStyleLoaded`/`once`.
 */
export function whenStyleReady(map: MLMap, fn: () => void): void {
  const candidate = map as MLMap & {
    isStyleLoaded?: () => boolean;
    once?: MLMap["once"];
  };
  let loaded = true;
  if (typeof candidate.isStyleLoaded === "function") {
    try {
      // MapLibre types this as `boolean | void`; treat void as loaded.
      loaded = candidate.isStyleLoaded() !== false;
    } catch {
      loaded = true;
    }
  }
  if (loaded || typeof candidate.once !== "function") {
    fn();
    return;
  }
  candidate.once("style.load", () => fn());
}
