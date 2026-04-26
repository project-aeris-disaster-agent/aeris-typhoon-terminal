/**
 * Single source of truth for MGB flood hazard palette.
 *
 * Previously these hex values were defined independently in three places
 * (`services/map-scene.ts`, `services/hazard-layers.ts`, and
 * `services/three-scene.ts`), causing drift risk when MGB cartography
 * conventions were adjusted. All flood rendering paths now import from here.
 */

export const FLOOD_LEVEL_STYLE = {
  low: { color: "#fde047", hex: 0xfde047, label: "Low (<0.5 m)" },
  medium: { color: "#fb923c", hex: 0xfb923c, label: "Medium (0.5\u20131.5 m)" },
  high: { color: "#dc2626", hex: 0xdc2626, label: "High (>1.5 m)" },
} as const;

export type FloodLevel = keyof typeof FLOOD_LEVEL_STYLE;

export const FLOOD_FALLBACK_COLOR = "#7f93a8";

/**
 * MapLibre `match` expression keyed by the `floodLevel` property on
 * annotated OSM features (roads, water). Falls back to neutral grey for
 * features without a tag.
 */
export const FLOOD_LEVEL_COLOR_EXPR = [
  "match",
  ["coalesce", ["get", "floodLevel"], ""],
  "high",
  FLOOD_LEVEL_STYLE.high.color,
  "medium",
  FLOOD_LEVEL_STYLE.medium.color,
  "low",
  FLOOD_LEVEL_STYLE.low.color,
  FLOOD_FALLBACK_COLOR,
] as const;

/**
 * MapLibre `match` expression keyed by the `level` property on MGB
 * flood-hazard pack features. Falls back to a cool blue so obviously
 * untagged rings remain visible for debugging.
 */
export const FLOOD_MGB_COLOR_EXPR: unknown[] = [
  "match",
  ["get", "level"],
  "low",
  FLOOD_LEVEL_STYLE.low.color,
  "medium",
  FLOOD_LEVEL_STYLE.medium.color,
  "high",
  FLOOD_LEVEL_STYLE.high.color,
  "#60a5fa",
];

/** Three.js wireframe linewidth per severity (wider = more visually urgent). */
export const FLOOD_WIRE_LINEWIDTH: Record<FloodLevel, number> = {
  low: 1.5,
  medium: 2.2,
  high: 3.0,
};

/**
 * Water surface styling for natural-looking hazard polygons.
 * Controls halo, fill pattern, and edge blur applied per susceptibility level.
 *
 * Layer stack per flood pack:
 *   1. halo - soft outer wash (wide fill, low opacity, no pattern)
 *   2. fill - main body with water-noise pattern texture
 *   3. edge - feathered border (line-blur instead of hard outline)
 */
export const WATER_STYLE = {
  textureImage: "water-noise" as const,
  texturePath: "/textures/water-noise.png",

  halo: {
    opacity: 0.08,
    expandPx: 16,
  },

  /** Grayscale noise tile only (no fill-color on this layer). */
  pattern: {
    opacity: 0.36,
  },

  /** Translucent MGB tint layered on top of the pattern. */
  tint: {
    low: { opacity: 0.12 },
    medium: { opacity: 0.15 },
    high: { opacity: 0.18 },
  },

  edge: {
    opacity: 0.32,
    blur: 10,
    widthZoom: [
      [8, 0.8],
      [12, 1.8],
      [15, 2.6],
      [18, 3.2],
    ] as [number, number][],
  },
} as const;
