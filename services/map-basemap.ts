import type { Map as MLMap, AddLayerObject } from "maplibre-gl";
import type { BasemapTheme } from "@/config/basemap-style";
import { majorCityDotPaint } from "@/config/basemap-tiles";
import {
  AERIS_OVERLAY_ANCHOR_SOURCE_ID,
  AERIS_OVERLAY_TOP_LAYER_ID,
  BASEMAP_MARKERS_LAYER_ID,
  layerBeforeDynamicOverlays,
} from "@/config/map-layers";

const PH_MAJOR_CITIES_SOURCE_ID = "ph-major-cities";

const majorCities: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "Manila" }, geometry: { type: "Point", coordinates: [120.9842, 14.5995] } },
    { type: "Feature", properties: { name: "Quezon City" }, geometry: { type: "Point", coordinates: [121.0437, 14.6760] } },
    { type: "Feature", properties: { name: "Cebu City" }, geometry: { type: "Point", coordinates: [123.8854, 10.3157] } },
    { type: "Feature", properties: { name: "Davao City" }, geometry: { type: "Point", coordinates: [125.6128, 7.1907] } },
    { type: "Feature", properties: { name: "Tacloban" }, geometry: { type: "Point", coordinates: [125.0060, 11.2440] } },
    { type: "Feature", properties: { name: "Legazpi" }, geometry: { type: "Point", coordinates: [123.7342, 13.1391] } },
    { type: "Feature", properties: { name: "Iloilo City" }, geometry: { type: "Point", coordinates: [122.5621, 10.7202] } },
    { type: "Feature", properties: { name: "Zamboanga" }, geometry: { type: "Point", coordinates: [122.0790, 6.9214] } },
    { type: "Feature", properties: { name: "Cagayan de Oro" }, geometry: { type: "Point", coordinates: [124.6319, 8.4542] } },
    { type: "Feature", properties: { name: "Baguio" }, geometry: { type: "Point", coordinates: [120.5979, 16.4023] } },
  ],
};

const emptyAnchorCollection: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function ensureMajorCitySource(map: MLMap) {
  if (map.getSource(PH_MAJOR_CITIES_SOURCE_ID)) return;
  map.addSource(PH_MAJOR_CITIES_SOURCE_ID, {
    type: "geojson",
    data: majorCities,
  });
}

function ensureOverlayAnchorSource(map: MLMap) {
  if (map.getSource(AERIS_OVERLAY_ANCHOR_SOURCE_ID)) return;
  map.addSource(AERIS_OVERLAY_ANCHOR_SOURCE_ID, {
    type: "geojson",
    data: emptyAnchorCollection,
  });
}

function applyMajorCityMarkerPaint(map: MLMap, theme: BasemapTheme) {
  if (!map.getLayer(BASEMAP_MARKERS_LAYER_ID)) return;
  const paint = majorCityDotPaint(theme);
  for (const [key, value] of Object.entries(paint)) {
    map.setPaintProperty(BASEMAP_MARKERS_LAYER_ID, key, value);
  }
}

function ensureMajorCityMarkersLayer(map: MLMap, theme: BasemapTheme) {
  ensureMajorCitySource(map);
  const paint = majorCityDotPaint(theme);
  const spec: AddLayerObject = {
    id: BASEMAP_MARKERS_LAYER_ID,
    type: "circle",
    source: PH_MAJOR_CITIES_SOURCE_ID,
    minzoom: 5.2,
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        5,
        1.4,
        8,
        2.2,
        12,
        3.2,
      ],
      "circle-color": paint["circle-color"],
      "circle-opacity": paint["circle-opacity"],
      "circle-stroke-color": paint["circle-stroke-color"],
      "circle-stroke-width": 1,
    },
  };

  if (map.getLayer(BASEMAP_MARKERS_LAYER_ID)) {
    map.removeLayer(BASEMAP_MARKERS_LAYER_ID);
  }
  map.addLayer(spec, layerBeforeDynamicOverlays(map));
}

/** Invisible layer pinned to the top of the stack for stable dynamic marker z-order. */
export function ensureAerisOverlayTopSlot(map: MLMap) {
  ensureOverlayAnchorSource(map);
  if (map.getLayer(AERIS_OVERLAY_TOP_LAYER_ID)) {
    map.moveLayer(AERIS_OVERLAY_TOP_LAYER_ID);
    return;
  }
  map.addLayer({
    id: AERIS_OVERLAY_TOP_LAYER_ID,
    type: "circle",
    source: AERIS_OVERLAY_ANCHOR_SOURCE_ID,
    minzoom: 24,
    paint: {
      "circle-radius": 0,
      "circle-opacity": 0,
    },
  });
}

/** Major-city dots + overlay top slot — call after every basemap style load/swap. */
export function ensureBasemapOverlays(map: MLMap, theme: BasemapTheme) {
  ensureMajorCityMarkersLayer(map, theme);
  ensureAerisOverlayTopSlot(map);
  applyMajorCityMarkerPaint(map, theme);
}
