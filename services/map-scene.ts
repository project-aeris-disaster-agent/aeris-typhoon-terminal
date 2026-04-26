import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import { escapeHtml } from "@/lib/sanitize";
import { PH_BBOX } from "@/config/region";
import { FLOOD_LEVEL_COLOR_EXPR } from "@/config/flood-colors";
import {
  DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
  type FloodVisualizationSettings,
} from "@/config/flood-visualization";
// NOTE: only `type` imports here — the Three.js-backed scene module is
// loaded dynamically when the user first enters 3D mode so `three` does
// not land in the initial JS bundle.
import type {
  BuildingFeature,
  FacilityFeature,
  FloodPolygonFeature,
  ThreeSceneHandle,
} from "@/services/three-scene";

export type SceneLayerId =
  | "hillshade"
  | "roads"
  | "buildings"
  | "critical-facilities";

type OsmContextPayload = {
  buildings: GeoJSON.FeatureCollection;
  roads: GeoJSON.FeatureCollection;
  water: GeoJSON.FeatureCollection;
  facilities: GeoJSON.FeatureCollection;
  generatedAt: string;
  attribution: string;
};

export type FloodImpactCounts = {
  low: number;
  medium: number;
  high: number;
};

export type SceneSummary = {
  buildingCount: number;
  roadCount: number;
  facilityCount: number;
  facilitiesByCategory: Record<string, number>;
  /**
   * Precomputed MGB flood impact counts for the currently loaded preset.
   * Each number is the count of features whose footprint/geometry intersects
   * a flood polygon of that level. Populated by
   * ``scripts/annotate_flood_impact.py`` and consumed by the LayerLegend.
   */
  floodImpact: {
    buildings: FloodImpactCounts;
    roads: FloodImpactCounts;
  };
  generatedAt: string;
  attribution: string;
};

export type SceneStatus = string | null;

export const DEFAULT_SCENE_VISIBILITY: Record<SceneLayerId, boolean> = {
  hillshade: true,
  roads: true,
  buildings: true,
  "critical-facilities": true,
};

export const DEFAULT_TERRAIN_EXAGGERATION = 1.35;
const SCENE_PACK_VERSION = "2026-04-24-11-flood-water-tag-ev";
const CONTEXT_SOURCE_IDS = [
  "osm-context-buildings",
  "osm-context-roads",
  "osm-context-water",
  "osm-context-facilities",
] as const;
/**
 * Layer visibility map. Buildings and critical-facilities are rendered via a
 * Three.js custom layer (`lyr-three-scene`), so their visibility is driven
 * programmatically through the scene handle rather than via setLayoutProperty.
 */
const SCENE_LAYER_VISIBILITY: Record<SceneLayerId, string[]> = {
  hillshade: ["lyr-terrain-hillshade"],
  roads: ["lyr-osm-roads"],
  buildings: [],
  "critical-facilities": ["lyr-osm-facility-labels"],
};
const facilityPopupBound = new WeakSet<MLMap>();

type SceneState = {
  terrainEnabled: boolean;
  terrainExaggeration: number;
  sceneVisibility: Record<SceneLayerId, boolean>;
  lastContextKey: ScenePresetId | null;
  refreshInFlight: boolean;
  three: ThreeSceneHandle | null;
  threePromise: Promise<ThreeSceneHandle | null> | null;
  mapRef: { current: MLMap | null };
  floodImpactActive: boolean;
  // Cached last payloads so that if the Three.js layer is created *after*
  // OSM context / flood data has been pushed, we can seed it on first load.
  lastBuildings: BuildingFeature[];
  lastFacilities: FacilityFeature[];
  lastFloodFeatures: FloodPolygonFeature[];
  lastFloodVisible: boolean;
  lastFloodOpacity: number;
  lastFloodVisualizationSettings: FloodVisualizationSettings | null;
  lastFloodLevelVisibility: Record<"low" | "medium" | "high", boolean>;
  facilityPriorityFilter: number;
  animationsEnabled: boolean;
};

const sceneState = new WeakMap<MLMap, SceneState>();

export function getFloodVisualizationSettings(
  map: MLMap,
): FloodVisualizationSettings {
  return (
    getSceneState(map).lastFloodVisualizationSettings ??
    DEFAULT_FLOOD_VISUALIZATION_SETTINGS
  );
}

/** Global flood opacity slider (0–1); Three.js decals + MapLibre 2D stack. */
export function getFloodPolygonOpacity(map: MLMap): number {
  return getSceneState(map).lastFloodOpacity;
}

function getSceneState(map: MLMap): SceneState {
  let state = sceneState.get(map);
  if (!state) {
    state = {
      terrainEnabled: false,
      terrainExaggeration: DEFAULT_TERRAIN_EXAGGERATION,
      sceneVisibility: { ...DEFAULT_SCENE_VISIBILITY },
      lastContextKey: null,
      refreshInFlight: false,
      three: null,
      threePromise: null,
      mapRef: { current: map },
      floodImpactActive: false,
      lastBuildings: [],
      lastFacilities: [],
      lastFloodFeatures: [],
      lastFloodVisible: false,
      lastFloodOpacity: 1,
      lastFloodVisualizationSettings: null,
      lastFloodLevelVisibility: { low: true, medium: true, high: true },
      facilityPriorityFilter: 0,
      animationsEnabled: true,
    };
    sceneState.set(map, state);
  }
  return state;
}

function ensureTerrainSource(map: MLMap) {
  if (map.getSource("ph-terrain-dem")) return;
  map.addSource("ph-terrain-dem", {
    type: "raster-dem",
    tiles: ["/dem/terrain-rgb/{z}/{x}/{y}.png"],
    tileSize: 256,
    bounds: PH_BBOX,
    maxzoom: 8,
    attribution: "Philippine DEM / SRTM",
    encoding: "mapbox",
  } as maplibregl.RasterDEMSourceSpecification);
}

function ensureContextSources(map: MLMap) {
  const emptyCollection = emptyFeatureCollection();

  for (const id of CONTEXT_SOURCE_IDS) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: emptyCollection });
    }
  }
}

function ensureHillshadeLayer(map: MLMap) {
  if (map.getLayer("lyr-terrain-hillshade")) return;
  map.addLayer({
    id: "lyr-terrain-hillshade",
    type: "hillshade",
    source: "ph-terrain-dem",
    layout: { visibility: "none" },
    paint: {
      "hillshade-shadow-color": "#05080c",
      "hillshade-highlight-color": "#2a3a4a",
      "hillshade-accent-color": "#1a2834",
      "hillshade-exaggeration": 0.4,
    },
  });
}

// Base road colour expression (roadClass-driven). Never changes — flood
// highlighting is done by a dedicated sibling layer, not by swapping
// ``lyr-osm-roads``'s paint (which made sparse-flood regions look empty).
const ROAD_COLOR_DEFAULT = [
  "match",
  ["get", "roadClass"],
  "motorway",
  "#ffd166",
  "trunk",
  "#ffb347",
  "primary",
  "#ff8c42",
  "secondary",
  "#d0d8e2",
  "#7f93a8",
] as const;

function ensureRoadLayer(map: MLMap) {
  if (!map.getLayer("lyr-osm-roads")) {
    map.addLayer({
      id: "lyr-osm-roads",
      type: "line",
      source: "osm-context-roads",
      layout: {
        visibility: "none",
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": ROAD_COLOR_DEFAULT as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>,
        "line-opacity": 0.75,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          0.5,
          11,
          ["coalesce", ["get", "strokeWidth"], 1.2],
          14,
          ["*", ["coalesce", ["get", "strokeWidth"], 1.2], 1.8],
        ],
      },
    });
  }

  // Non-destructive flood highlight layer. Filters to segments tagged with
  // a floodLevel, then overlays them in the MGB palette at ~1.6x width so
  // they pop over the default roadClass colouring underneath. Toggled by
  // ``setFloodImpactHighlight``.
  if (!map.getLayer("lyr-osm-roads-flood")) {
    map.addLayer({
      id: "lyr-osm-roads-flood",
      type: "line",
      source: "osm-context-roads",
      filter: ["!=", ["coalesce", ["get", "floodLevel"], ""], ""],
      layout: {
        visibility: "none",
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": FLOOD_LEVEL_COLOR_EXPR as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>,
        "line-opacity": 0.95,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          0.8,
          11,
          ["*", ["coalesce", ["get", "strokeWidth"], 1.2], 1.6],
          14,
          ["*", ["coalesce", ["get", "strokeWidth"], 1.2], 2.6],
        ],
      },
    });
  }
}

/**
 * Set the minimum facility priority to render. Facilities with priority
 * below this threshold are skipped. Priority values:
 * 5 = hospital, 4 = evacuation, 3 = fire_station, 2 = police, 1 = other.
 * Pass 0 to render all facilities (default).
 */
export function setFacilityPriorityFilter(map: MLMap, minPriority: number) {
  const state = getSceneState(map);
  if (state.facilityPriorityFilter === minPriority) return;
  state.facilityPriorityFilter = minPriority;
  state.three?.setFacilityPriorityFilter(minPriority);
}

/**
 * Toggle flood-impact highlighting for the 2D roads and the 3D buildings.
 * When ``active`` is true, the dedicated ``lyr-osm-roads-flood`` overlay
 * becomes visible and the 3D building shader tints anything tagged with
 * ``floodLevel``. The base road layer keeps its default roadClass paint
 * either way, so regions with sparse flood coverage never "disappear".
 *
 * Idempotent — safe to call on every hazard toggle in the UI.
 */
export function setFloodImpactHighlight(map: MLMap, active: boolean) {
  const state = getSceneState(map);
  if (state.floodImpactActive === active) return;
  state.floodImpactActive = active;

  if (map.getLayer("lyr-osm-roads-flood")) {
    map.setLayoutProperty(
      "lyr-osm-roads-flood",
      "visibility",
      active ? "visible" : "none",
    );
  }

  // When Three.js hasn't loaded yet this is a no-op and the cached
  // `floodImpactActive` gets applied on scene bootstrap.
  state.three?.setFloodHighlight(active);
}

/**
 * Push a new set of flood polygon features to the Three.js wireframe renderer.
 * Pass ``visible=false`` (and an empty array) to hide the wireframe.
 * Safe to call before the Three.js layer has been added — the handle stores
 * the features as pending and applies them in ``onAdd``.
 */
export function setFloodWireframe(
  map: MLMap,
  features: FloodPolygonFeature[],
  visible: boolean,
) {
  const state = getSceneState(map);
  state.lastFloodFeatures = features;
  state.lastFloodVisible = visible;
  state.three?.setFloodPolygons(features);
  state.three?.setFloodPolygonsVisible(visible);
}

/**
 * Update the opacity of the Three.js flood hazard wireframe (0–1).
 * Mirrors the ``setFloodHazardOpacity`` call in ``hazard-layers.ts`` so the
 * layer-legend opacity slider drives both the MapLibre outline and the 3D wires.
 */
export function setFloodWireframeOpacity(map: MLMap, opacity: number) {
  const state = getSceneState(map);
  state.lastFloodOpacity = opacity;
  state.three?.setFloodPolygonOpacity(opacity);
}

export function setFloodVisualizationSettings(
  map: MLMap,
  settings: FloodVisualizationSettings,
) {
  const state = getSceneState(map);
  state.lastFloodVisualizationSettings = settings;
  state.three?.setFloodVisualizationSettings(settings);
  void import("@/services/hazard-layers").then(({ applyFloodMapLibreVisualization }) => {
    applyFloodMapLibreVisualization(map, settings);
  });
}

/**
 * Enable or disable per-frame animations (facility pin bobbing + flood pulse).
 * Disabling stops ``triggerRepaint`` loops, letting the map go idle on static
 * scenes and reducing continuous GPU/CPU load.
 */
export function setSceneAnimationsEnabled(map: MLMap, enabled: boolean) {
  const state = getSceneState(map);
  state.animationsEnabled = enabled;
  state.three?.setAnimationsEnabled(enabled);
}

/** Show / hide the wireframe mesh for a single flood hazard level. */
export function setFloodLevelVisible(
  map: MLMap,
  level: "low" | "medium" | "high",
  visible: boolean,
) {
  const state = getSceneState(map);
  state.lastFloodLevelVisibility[level] = visible;
  state.three?.setFloodLevelVisible(level, visible);
}

/**
 * Create the Three.js custom layer and attach it to the map. Dynamically
 * imports the Three.js-backed module so `three` does not land in the
 * initial JS bundle — it only loads the first time the user enters 3D mode.
 *
 * Idempotent: subsequent calls return the same promise / handle. Seeds the
 * newly-created layer with the latest cached OSM + flood payloads so
 * nothing visually "blinks" when switching into 3D.
 */
async function ensureThreeSceneLayer(
  map: MLMap,
): Promise<ThreeSceneHandle | null> {
  const state = getSceneState(map);
  if (state.three) return state.three;
  if (state.threePromise) return state.threePromise;

  state.threePromise = (async () => {
    // Dynamic import isolates Three.js + three-scene into its own chunk.
    const mod = await import("@/services/three-scene");
    const handle = mod.createThreeSceneLayer(state.mapRef);
    // Insert beneath facility labels so the text stays legible on top of
    // the 3D buildings and beacons.
    const beforeId = map.getLayer("lyr-osm-facility-labels")
      ? "lyr-osm-facility-labels"
      : undefined;
    if (!map.getLayer("lyr-three-scene")) {
      map.addLayer(handle.layer, beforeId);
    }
    state.three = handle;

    // Replay cached payloads so the scene looks correct immediately.
    if (state.lastBuildings.length) handle.setBuildings(state.lastBuildings);
    if (state.lastFacilities.length)
      handle.setFacilities(state.lastFacilities);
    handle.setBuildingsVisible(state.sceneVisibility.buildings);
    handle.setFacilitiesVisible(state.sceneVisibility["critical-facilities"]);
    handle.setFacilityPriorityFilter(state.facilityPriorityFilter);
    handle.setFloodHighlight(state.floodImpactActive);
    if (state.lastFloodFeatures.length)
      handle.setFloodPolygons(state.lastFloodFeatures);
    handle.setFloodPolygonsVisible(state.lastFloodVisible);
    handle.setFloodPolygonOpacity(state.lastFloodOpacity);
    if (state.lastFloodVisualizationSettings) {
      handle.setFloodVisualizationSettings(state.lastFloodVisualizationSettings);
    }
    for (const lvl of ["low", "medium", "high"] as const) {
      handle.setFloodLevelVisible(lvl, state.lastFloodLevelVisibility[lvl]);
    }
    handle.setAnimationsEnabled(state.animationsEnabled);
    return handle;
  })();
  return state.threePromise;
}

function ensureFacilityLabelLayer(map: MLMap) {
  if (map.getLayer("lyr-osm-facility-labels")) return;
  map.addLayer({
    id: "lyr-osm-facility-labels",
    type: "symbol",
    source: "osm-context-facilities",
    minzoom: 11,
    layout: {
      visibility: "none",
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        10,
        15,
        13,
      ],
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-allow-overlap": false,
      "symbol-sort-key": ["coalesce", ["get", "priority"], 0],
    },
    paint: {
      "text-color": "#e6edf3",
      "text-halo-color": "#081017",
      "text-halo-width": 1.2,
      "text-opacity": 0.92,
    },
  });
}

function ensureFacilityPopup(map: MLMap) {
  if (facilityPopupBound.has(map)) return;

  // Clicks on the (invisible) facility label symbols surface the popup.
  map.on("click", "lyr-osm-facility-labels", (event) => {
    const feature = event.features?.[0];
    if (!feature?.geometry || feature.geometry.type !== "Point") return;
    const coordinates = [...feature.geometry.coordinates] as [number, number];
    const props = feature.properties ?? {};
    const name = escapeHtml(String(props.name ?? "Critical facility"));
    const category = escapeHtml(String(props.categoryLabel ?? "Facility"));
    const source = escapeHtml(String(props.source ?? "OpenStreetMap"));

    new maplibregl.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(coordinates)
      .setHTML(
        `<div style="min-width:180px">
          <div style="font-weight:700;color:#e6edf3">${name}</div>
          <div style="font-size:12px;color:#9fb0c2;margin-top:4px">${category}</div>
          <div style="font-size:11px;color:#7f93a8;margin-top:6px">Source: ${source}</div>
        </div>`,
      )
      .addTo(map);
  });

  map.on("mouseenter", "lyr-osm-facility-labels", () => {
    map.getCanvas().style.cursor = "pointer";
  });

  map.on("mouseleave", "lyr-osm-facility-labels", () => {
    map.getCanvas().style.cursor = "";
  });

  facilityPopupBound.add(map);
}

function ensureSceneLayers(map: MLMap) {
  ensureTerrainSource(map);
  ensureContextSources(map);
  ensureHillshadeLayer(map);
  ensureRoadLayer(map);
  ensureFacilityLabelLayer(map);
  // Three.js custom layer is NOT created at init anymore — it is deferred
  // to the first `mode=3d` entry so the three.js bundle and its setup cost
  // stays out of the initial render path.
  ensureFacilityPopup(map);
}

function setSourceData(map: MLMap, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

async function refreshOsmContext(map: MLMap) {
  const state = getSceneState(map);
  if (state.refreshInFlight) return;

  const zoom = map.getZoom();
  if (zoom < 10) {
    clearSceneContext(map);
    state.lastContextKey = null;
    return;
  }

  const presetId = nearestScenePreset(map);
  if (!presetId) {
    clearSceneContext(map);
    state.lastContextKey = null;
    return;
  }
  if (presetId === state.lastContextKey) return;

  state.refreshInFlight = true;
  try {
    // OSM context packs are static JSON under /public. They change only
    // when `SCENE_PACK_VERSION` bumps (via the ?v= cache buster), so we
    // use `force-cache` to let the browser / service worker serve a
    // cached copy across pans, preventing repeat downloads of the same
    // megabyte-sized payload on every moveend.
    const response = await fetch(`/osm-context/${presetId}.json?v=${SCENE_PACK_VERSION}`, {
      cache: "force-cache",
    });
    if (!response.ok) {
      emitSceneStatus(`3D context pack unavailable for ${presetId} (${response.status}).`);
      clearSceneContext(map);
      state.lastContextKey = null;
      return;
    }

    const payload = (await response.json()) as OsmContextPayload;
    if (!isOsmContextPayload(payload)) {
      emitSceneStatus(`3D context pack for ${presetId} is invalid.`);
      clearSceneContext(map);
      state.lastContextKey = null;
      return;
    }
    setSourceData(map, "osm-context-buildings", payload.buildings);
    setSourceData(map, "osm-context-roads", payload.roads);
    setSourceData(map, "osm-context-water", payload.water);
    setSourceData(map, "osm-context-facilities", payload.facilities);
    // Cache payloads so the Three.js layer (which loads lazily on first
    // 3D-mode entry) can be seeded with the latest data when it arrives.
    state.lastBuildings = payload.buildings.features as BuildingFeature[];
    state.lastFacilities = payload.facilities.features as FacilityFeature[];
    state.three?.setBuildings(state.lastBuildings);
    state.three?.setFacilities(state.lastFacilities);
    state.lastContextKey = presetId;
    emitSceneSummary(payload);
    emitSceneStatus(null);
  } catch {
    emitSceneStatus(`3D context pack request failed for ${presetId}.`);
    clearSceneContext(map);
    state.lastContextKey = null;
  } finally {
    state.refreshInFlight = false;
  }
}

function setLayerVisibility(map: MLMap, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

export function initMapScene(map: MLMap) {
  ensureSceneLayers(map);
  setTerrainExaggeration(map, DEFAULT_TERRAIN_EXAGGERATION);
  setSceneLayerVisibility(map, "hillshade", true);
  setSceneLayerVisibility(map, "roads", true);
  setSceneLayerVisibility(map, "buildings", true);
  setSceneLayerVisibility(map, "critical-facilities", true);
  void refreshOsmContext(map);

  // Debounce `moveend` refetches: users frequently pan-drag-pan-drag, and
  // each `moveend` would otherwise re-evaluate the scene preset and kick
  // off a potentially megabyte-sized pack download. Wait 500ms of quiet
  // before actually refreshing, so rapid pan sequences collapse into one
  // final fetch.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  const onMoveEnd = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshOsmContext(map);
    }, 500);
  };
  map.on("moveend", onMoveEnd);

  if (typeof map.once === "function") {
    map.once("remove", () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      map.off("moveend", onMoveEnd);
    });
  }
}

export function applyMapViewMode(map: MLMap, mode: "2d" | "3d") {
  const is3D = mode === "3d";

  if (is3D) {
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    setTerrainEnabled(map, true);
    // Kick off the Three.js layer load on first 3D entry. Fire-and-forget —
    // the promise resolves asynchronously; meanwhile the camera flight is
    // already underway so the user sees terrain + pitch immediately.
    void ensureThreeSceneLayer(map);
    map.easeTo({
      pitch: 62,
      bearing: -18,
      zoom: Math.max(map.getZoom(), 8.2),
      duration: 800,
      essential: true,
    });
  } else {
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    setTerrainEnabled(map, false);
    map.easeTo({
      pitch: 0,
      bearing: 0,
      duration: 700,
      essential: true,
    });
  }
}

type TerrainCapableMap = MLMap & {
  setTerrain: (next: { source: string; exaggeration?: number } | null) => void;
};

export function setTerrainEnabled(map: MLMap, enabled: boolean) {
  const state = getSceneState(map);
  state.terrainEnabled = enabled;
  if (enabled) ensureTerrainSource(map);
  (map as TerrainCapableMap).setTerrain(
    enabled
      ? { source: "ph-terrain-dem", exaggeration: state.terrainExaggeration }
      : null,
  );
}

export function setTerrainExaggeration(map: MLMap, exaggeration: number) {
  const state = getSceneState(map);
  state.terrainExaggeration = exaggeration;
  if (!state.terrainEnabled) return;
  ensureTerrainSource(map);
  (map as TerrainCapableMap).setTerrain({
    source: "ph-terrain-dem",
    exaggeration,
  });
}

export function setSceneLayerVisibility(map: MLMap, id: SceneLayerId, visible: boolean) {
  const state = getSceneState(map);
  state.sceneVisibility[id] = visible;

  for (const layerId of SCENE_LAYER_VISIBILITY[id]) {
    setLayerVisibility(map, layerId, visible);
  }

  if (id === "buildings") {
    state.three?.setBuildingsVisible(visible);
  } else if (id === "critical-facilities") {
    state.three?.setFacilitiesVisible(visible);
  }
}

export const SCENE_LAYERS: Array<{
  id: SceneLayerId;
  label: string;
  swatch: string;
}> = [
  { id: "hillshade", label: "Terrain Shading", swatch: "#1f4f63" },
  { id: "roads", label: "Road Network", swatch: "#ffb347" },
  { id: "buildings", label: "3D Buildings", swatch: "#c1cad6" },
  { id: "critical-facilities", label: "Critical Facilities", swatch: "#34d399" },
];

export const SCENE_PRESETS = [
  {
    id: "ncr",
    label: "Metro Manila",
    center: [120.9842, 14.5995] as [number, number],
    zoom: 12.4,
    pitch: 64,
    bearing: -18,
  },
  {
    id: "bicol",
    label: "Bicol",
    center: [123.4, 13.5] as [number, number],
    zoom: 10.3,
    pitch: 60,
    bearing: -16,
  },
  {
    id: "eastern-visayas",
    label: "Eastern Visayas",
    center: [125.0, 11.2] as [number, number],
    zoom: 10.5,
    pitch: 60,
    bearing: -18,
  },
  {
    id: "cebu",
    label: "Cebu",
    center: [123.8854, 10.3157] as [number, number],
    zoom: 12.1,
    pitch: 64,
    bearing: -14,
  },
  {
    id: "davao",
    label: "Davao",
    center: [125.6128, 7.1907] as [number, number],
    zoom: 12,
    pitch: 63,
    bearing: -16,
  },
] as const;

export type ScenePresetId = (typeof SCENE_PRESETS)[number]["id"];

export function flyToScenePreset(map: MLMap, presetId: ScenePresetId) {
  const preset = SCENE_PRESETS.find((item) => item.id === presetId);
  if (!preset) return;
  map.flyTo({
    center: preset.center,
    zoom: preset.zoom,
    pitch: preset.pitch,
    bearing: preset.bearing,
    duration: 1600,
    essential: true,
  });
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function clearSceneContext(map: MLMap) {
  const empty = emptyFeatureCollection();
  for (const sourceId of CONTEXT_SOURCE_IDS) {
    setSourceData(map, sourceId, empty);
  }
  const state = sceneState.get(map);
  state?.three?.setBuildings([]);
  state?.three?.setFacilities([]);
  emitSceneSummary({
    buildings: empty,
    roads: empty,
    water: empty,
    facilities: empty,
    generatedAt: new Date().toISOString(),
    attribution: "No static scene pack loaded",
  });
}

function nearestScenePreset(map: MLMap): ScenePresetId | null {
  const center = map.getCenter();
  let best: { id: ScenePresetId; distance: number } | null = null;

  for (const preset of SCENE_PRESETS) {
    const distance = Math.hypot(center.lng - preset.center[0], center.lat - preset.center[1]);
    if (!best || distance < best.distance) {
      best = { id: preset.id, distance };
    }
  }

  return best && best.distance < 2.5 ? best.id : null;
}

function emitSceneSummary(payload: OsmContextPayload) {
  if (typeof window === "undefined") return;

  const facilitiesByCategory = payload.facilities.features.reduce<Record<string, number>>(
    (acc, feature) => {
      const category = String(feature.properties?.category ?? "other");
      acc[category] = (acc[category] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const countFloodImpact = (
    features: GeoJSON.Feature[],
  ): FloodImpactCounts => {
    const counts: FloodImpactCounts = { low: 0, medium: 0, high: 0 };
    for (const f of features) {
      const level = f.properties?.floodLevel as
        | "low"
        | "medium"
        | "high"
        | undefined;
      if (level && level in counts) counts[level] += 1;
    }
    return counts;
  };

  const summary: SceneSummary = {
    buildingCount: payload.buildings.features.length,
    roadCount: payload.roads.features.length,
    facilityCount: payload.facilities.features.length,
    facilitiesByCategory,
    floodImpact: {
      buildings: countFloodImpact(payload.buildings.features),
      roads: countFloodImpact(payload.roads.features),
    },
    generatedAt: payload.generatedAt,
    attribution: payload.attribution,
  };

  window.dispatchEvent(
    new CustomEvent<SceneSummary>("aeris:scene-summary", {
      detail: summary,
    }),
  );
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (typeof value !== "object" || value === null) return false;
  const collection = value as GeoJSON.FeatureCollection;
  return (
    collection.type === "FeatureCollection" &&
    Array.isArray(collection.features) &&
    collection.features.every(
      (feature) =>
        typeof feature === "object" &&
        feature !== null &&
        feature.type === "Feature" &&
        typeof feature.geometry === "object" &&
        feature.geometry !== null &&
        typeof feature.geometry.type === "string" &&
        "coordinates" in feature.geometry &&
        Array.isArray(feature.geometry.coordinates),
    )
  );
}

function isOsmContextPayload(value: unknown): value is OsmContextPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<OsmContextPayload>;
  return (
    isFeatureCollection(payload.buildings) &&
    isFeatureCollection(payload.roads) &&
    isFeatureCollection(payload.water) &&
    isFeatureCollection(payload.facilities) &&
    typeof payload.generatedAt === "string" &&
    typeof payload.attribution === "string"
  );
}

function emitSceneStatus(detail: SceneStatus) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SceneStatus>("aeris:scene-status", {
      detail,
    }),
  );
}
