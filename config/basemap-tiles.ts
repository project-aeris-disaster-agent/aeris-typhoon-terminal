export type BasemapTheme = "light" | "dark";

const DARK_BASE_TILES = [
  "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
  "https://d.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
];

const DARK_LABEL_TILES = [
  "https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  "https://d.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
];

const LIGHT_BASE_TILES = [
  "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
  "https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
];

const LIGHT_LABEL_TILES = [
  "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
  "https://d.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
];

/** CARTO @2x tiles are 512px; match MapLibre tileSize to reduce resampling blur. */
export const BASEMAP_TILE_SIZE = 512;

export const BASEMAP_RASTER_FADE_MS = 0;

export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function getBasemapTiles(theme: BasemapTheme): {
  baseTiles: string[];
  labelTiles: string[];
} {
  return theme === "dark"
    ? { baseTiles: DARK_BASE_TILES, labelTiles: DARK_LABEL_TILES }
    : { baseTiles: LIGHT_BASE_TILES, labelTiles: LIGHT_LABEL_TILES };
}

export function majorCityDotPaint(theme: BasemapTheme) {
  return {
    "circle-color": theme === "dark" ? "#7dd3fc" : "#0ea5e9",
    "circle-opacity": theme === "dark" ? 0.8 : 0.74,
    "circle-stroke-color": theme === "dark" ? "#06111a" : "#f8fbff",
  };
}
