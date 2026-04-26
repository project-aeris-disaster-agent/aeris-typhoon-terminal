import {
  FLOOD_LEVEL_STYLE,
  type FloodLevel,
} from "@/config/flood-colors";

export type FloodVisualizationSettings = {
  wireframeEnabled: boolean;
  wireframeThickness: number;
  wireframePolygonCount: number;
  wireframeBrightness: number;
  wireframeColors: Record<FloodLevel, string>;
  waterColor: string;
  waterOpacity: number;
  edgeFadeDistance: number;
  edgeFadeOpacity: number;
};

export const DEFAULT_FLOOD_VISUALIZATION_SETTINGS: FloodVisualizationSettings = {
  wireframeEnabled: true,
  wireframeThickness: 0.38,
  // Reduced from 100% to 40% by default — fewer GPU line segments at startup
  // with no perceptible loss on typical flood packs. Users can raise via slider.
  wireframePolygonCount: 40,
  wireframeBrightness: 1,
  wireframeColors: {
    low: FLOOD_LEVEL_STYLE.low.color,
    medium: FLOOD_LEVEL_STYLE.medium.color,
    high: FLOOD_LEVEL_STYLE.high.color,
  },
  waterColor: "#38bdf8",
  waterOpacity: 0.24,
  // Reduced from 50 m to 20 m — shorter Turf buffer radius means less CPU
  // work per polygon rebuild while still showing a soft shoreline transition.
  edgeFadeDistance: 20,
  edgeFadeOpacity: 0.8,
};
