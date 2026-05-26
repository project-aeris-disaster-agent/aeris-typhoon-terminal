import type { Map as MLMap } from "maplibre-gl";
import type { BasemapTheme } from "@/config/basemap-style";
import { ensureBasemapOverlays } from "@/services/map-basemap";
import { reattachHazardLayersAfterStyleChange } from "@/services/hazard-layers";
import { reattachLiveWeatherImageryAfterStyleChange } from "@/services/live-weather-overlay";
import {
  applyMapViewMode,
  reattachSceneAfterStyleChange,
  setMapSceneTheme,
} from "@/services/map-scene";

export type MapStyleReattachContext = {
  theme: BasemapTheme;
  mode: "2d" | "3d";
};

/**
 * Rebuild Aeris-owned layers after `map.setStyle` (theme swap or style reload).
 * Basemap vector styles replace all layers; this restores overlay stack order.
 */
export async function reattachMapOverlaysAfterStyleChange(
  map: MLMap,
  ctx: MapStyleReattachContext,
): Promise<void> {
  ensureBasemapOverlays(map, ctx.theme);
  reattachSceneAfterStyleChange(map);
  await reattachHazardLayersAfterStyleChange(map, ctx.mode);
  reattachLiveWeatherImageryAfterStyleChange(map);
  setMapSceneTheme(map, ctx.theme);
  applyMapViewMode(map, ctx.mode);
}
