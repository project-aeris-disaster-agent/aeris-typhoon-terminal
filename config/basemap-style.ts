export type BasemapTheme = "light" | "dark";

/** CARTO GL vector styles — shared layer ids across light/dark variants. */
export const CARTO_VECTOR_STYLE_URLS: Record<BasemapTheme, string> = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

/**
 * First symbol layer in CARTO Streets v1 styles (`waterway_label`). Context
 * overlays (flood, radar, hillshade, roads) insert before this anchor so vector
 * street/place labels render on top.
 */
export const CARTO_VECTOR_LABEL_ANCHOR_LAYER_ID = "waterway_label";

export function getBasemapStyleUrl(theme: BasemapTheme): string {
  return CARTO_VECTOR_STYLE_URLS[theme];
}
