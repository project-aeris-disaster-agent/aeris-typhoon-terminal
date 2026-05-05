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
import type { MapMode } from "./MapContainer";
import { applyMapViewMode } from "@/services/map-scene";

export type Map2DProps = {
  mode: MapMode;
  theme: "light" | "dark";
  onReady?: (map: MLMap) => void;
  className?: string;
};

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

/**
 * Region-locked MapLibre GL map for the Philippines. Pan/zoom is constrained
 * via `maxBounds` so users cannot navigate outside the archipelago.
 */
export function Map2D({ mode, theme, onReady, className }: Map2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
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

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles:
              themeRef.current === "dark" ? DARK_BASE_TILES : LIGHT_BASE_TILES,
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxzoom: 20,
          },
          "osm-labels": {
            type: "raster",
            tiles:
              themeRef.current === "dark" ? DARK_LABEL_TILES : LIGHT_LABEL_TILES,
            tileSize: 256,
            maxzoom: 20,
          },
          "ph-major-cities": {
            type: "geojson",
            data: majorCities,
          },
        },
        layers: [
          {
            id: "osm-base",
            type: "raster",
            source: "osm",
            paint: {
              "raster-fade-duration": 300,
            },
          },
          {
            id: "osm-top-labels",
            type: "raster",
            source: "osm-labels",
            paint: {
              "raster-opacity": 0.92,
              "raster-fade-duration": 0,
            },
          },
          {
            id: "ph-major-city-dots",
            type: "circle",
            source: "ph-major-cities",
            minzoom: 5.2,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.4, 8, 2.2, 12, 3.2],
              "circle-color": themeRef.current === "dark" ? "#7dd3fc" : "#0ea5e9",
              "circle-opacity": themeRef.current === "dark" ? 0.8 : 0.74,
              "circle-stroke-color":
                themeRef.current === "dark" ? "#06111a" : "#f8fbff",
              "circle-stroke-width": 1,
            },
          },
        ],
      },
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

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      mapRef.current = map;
      // Scene layers (terrain DEM, OSM context) must be added before we try
      // to apply the view mode, which may enable terrain.
      onReadyRef.current?.(map);
      applyMapViewMode(map, modeRef.current);
    });

    return () => {
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
    if (!map) return;
    const style = map.getStyle();
    if (!style?.sources) return;
    const nextStyle = structuredClone(style);
    const baseSource = nextStyle.sources.osm as { tiles?: string[] } | undefined;
    const labelSource = nextStyle.sources["osm-labels"] as { tiles?: string[] } | undefined;
    if (baseSource) baseSource.tiles = theme === "dark" ? DARK_BASE_TILES : LIGHT_BASE_TILES;
    if (labelSource) labelSource.tiles = theme === "dark" ? DARK_LABEL_TILES : LIGHT_LABEL_TILES;

    const cityLayer = nextStyle.layers.find((layer) => layer.id === "ph-major-city-dots");
    if (cityLayer && cityLayer.type === "circle") {
      cityLayer.paint = {
        ...(cityLayer.paint ?? {}),
        "circle-color": theme === "dark" ? "#7dd3fc" : "#0ea5e9",
        "circle-opacity": theme === "dark" ? 0.8 : 0.74,
        "circle-stroke-color": theme === "dark" ? "#06111a" : "#f8fbff",
      };
    }
    map.setStyle(nextStyle, { diff: true });
  }, [theme]);

  return <div ref={containerRef} className={className ?? "w-full h-full"} />;
}
