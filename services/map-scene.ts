import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import { notifyMapViewModeForSatelliteImagery } from "@/services/satellite-frames";
import { notifyLiveWeatherMapMode } from "@/services/live-weather-overlay";
import {
  closeFacilityPopup,
  openFacilityHoverPopup,
  refreshFacilityPopupTheme,
} from "@/services/facility-popup";
import { layerBeforeBasemapLabels } from "@/config/map-layers";
import {
  MAP_2D_MAX_BOUNDS,
  MAP_2D_MIN_ZOOM,
  MIN_ZOOM,
  PH_BBOX,
  PH_MAX_BOUNDS,
} from "@/config/region";
import { FLOOD_LEVEL_COLOR_EXPR } from "@/config/flood-colors";
import {
  DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
  type FloodVisualizationSettings,
} from "@/config/flood-visualization";
// Type-only import — Three.js scene module is dynamically loaded on first 3D
// entry so `three` does not land in the initial bundle.
import type {
  BuildingFeature,
  FacilityFeature,
  FloodPolygonFeature,
  ThreeSceneHandle,
} from "@/services/three-scene";

type TerrainCapableMap = MLMap & {
  setTerrain: (next: { source: string; exaggeration?: number } | null) => void;
};

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

type SceneTheme = "light" | "dark";

export type Address3DTarget = {
  lat: number;
  lon: number;
  /** Map zoom after 3D context loads; defaults to 15.5. */
  zoom?: number;
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
  floodImpact: {
    buildings: FloodImpactCounts;
    roads: FloodImpactCounts;
  };
  generatedAt: string;
  attribution: string;
};

export type SceneStatus = string | null;
export type SceneLoadingState = {
  threeLoading: boolean;
  contextLoading: boolean;
  majorLoading: boolean;
  majorLoadingMessage: string | null;
};
type SceneLoadingListener = (state: SceneLoadingState) => void;

export const DEFAULT_SCENE_VISIBILITY: Record<SceneLayerId, boolean> = {
  hillshade: true,
  roads: false,
  buildings: false,
  "critical-facilities": true,
};

function terrainExaggerationForZoom(base: number, zoom: number): number {
  if (zoom <= PH_TERRAIN_DEM_MAX_ZOOM) return base;
  const decay = Math.min(1, (zoom - PH_TERRAIN_DEM_MAX_ZOOM) * 0.14);
  return Math.max(base * 0.4, base * (1 - decay));
}

function applyTerrainExaggerationForCurrentZoom(map: MLMap) {
  const state = getSceneState(map);
  if (!state.terrainEnabled) return;
  ensureTerrainSource(map);
  const exaggeration = terrainExaggerationForZoom(
    state.terrainExaggeration,
    map.getZoom(),
  );
  (map as TerrainCapableMap).setTerrain({
    source: "ph-terrain-dem",
    exaggeration,
  });
}

function syncThreeHandleFromState(map: MLMap, handle: ThreeSceneHandle) {
  const state = getSceneState(map);
  if (state.lastBuildings.length) handle.setBuildings(state.lastBuildings);
  if (state.lastFacilities.length) handle.setFacilities(state.lastFacilities);
  handle.setBuildingsVisible(state.sceneVisibility.buildings);
  handle.setFacilitiesVisible(state.sceneVisibility["critical-facilities"]);
  handle.setFacilityPriorityFilter(state.facilityPriorityFilter);
  handle.setFloodHighlight(state.floodImpactActive);
  if (state.lastFloodFeatures.length) handle.setFloodPolygons(state.lastFloodFeatures);
  handle.setFloodPolygonsVisible(state.lastFloodVisible);
  handle.setFloodPolygonOpacity(state.lastFloodOpacity);
  if (state.lastFloodVisualizationSettings) {
    handle.setFloodVisualizationSettings(state.lastFloodVisualizationSettings);
  }
  for (const lvl of ["low", "medium", "high"] as const) {
    handle.setFloodLevelVisible(lvl, state.lastFloodLevelVisibility[lvl]);
  }
  handle.setAnimationsEnabled(state.animationsEnabled);
}

export const DEFAULT_TERRAIN_EXAGGERATION = 1.35;
/** Local DEM pyramid stops at z8 (`public/dem/generate_terrain_tiles.py`). */
export const PH_TERRAIN_DEM_MAX_ZOOM = 8;
const SCENE_PACK_VERSION = "2026-05-15-barangay-coverage";
const FACILITY_POINTS_SOURCE_ID = "osm-context-facility-labels";
const FACILITY_HIT_LAYER_ID = "lyr-osm-facility-hit";
// MapLibre sources for ambient context (roads, water, facility hit points).
// Facility details render in a single hover popup (see facility-popup.ts).
// Buildings are NOT a MapLibre source: they're rendered exclusively by the
// Three.js custom layer to keep a single source of truth and eliminate the
// dual-renderer "tag-and-filter" dance that used to break in non-NCR cities.
const CONTEXT_SOURCE_IDS = [
  "osm-context-roads",
  "osm-context-water",
  FACILITY_POINTS_SOURCE_ID,
] as const;

// Buildings and critical-facilities live exclusively on the Three.js
// `lyr-three-scene` custom layer; their visibility is driven through
// `state.three?.setBuildingsVisible / setFacilitiesVisible` in
// `setSceneLayerVisibility` rather than via setLayoutProperty.
const SCENE_LAYER_VISIBILITY: Record<SceneLayerId, string[]> = {
  hillshade: ["lyr-terrain-hillshade"],
  roads: ["lyr-osm-roads"],
  buildings: [],
  "critical-facilities": [FACILITY_HIT_LAYER_ID],
};
const facilityInteractionsBound = new WeakSet<MLMap>();

type SceneState = {
  terrainEnabled: boolean;
  terrainExaggeration: number;
  sceneVisibility: Record<SceneLayerId, boolean>;
  /** ID of the static scene pack currently loaded into Three.js. */
  loadedPackId: ScenePresetId | null;
  refreshInFlight: boolean;
  contextLoading: boolean;
  three: ThreeSceneHandle | null;
  threePromise: Promise<ThreeSceneHandle | null> | null;
  threeLoading: boolean;
  mapRef: { current: MLMap | null };
  floodImpactActive: boolean;
  // Cached payloads — replayed when the Three.js layer is created lazily so
  // it has data on first paint without re-fetching.
  lastBuildings: BuildingFeature[];
  lastFacilities: FacilityFeature[];
  lastFloodFeatures: FloodPolygonFeature[];
  lastFloodVisible: boolean;
  lastFloodOpacity: number;
  lastFloodVisualizationSettings: FloodVisualizationSettings | null;
  lastFloodLevelVisibility: Record<"low" | "medium" | "high", boolean>;
  facilityPriorityFilter: number;
  animationsEnabled: boolean;
  refreshRequestSeq: number;
  majorLoadingCount: number;
  majorLoadingMessage: string | null;
  activeScenePreset: ScenePresetId | null;
  /** First 3D entry eases the camera once per map session; later 2D↔3D toggles keep the viewport. */
  initial3DCameraApplied: boolean;
  contextRoads: GeoJSON.FeatureCollection;
  contextWater: GeoJSON.FeatureCollection;
  contextGeneratedAt: string;
  contextAttribution: string;
  theme: SceneTheme;
};

const sceneState = new WeakMap<MLMap, SceneState>();
const sceneLoadingListeners = new WeakMap<MLMap, Set<SceneLoadingListener>>();

const DEV = process.env.NODE_ENV === "development";
function perfStart(): number {
  return DEV ? performance.now() : 0;
}
function perfEnd(label: string, start: number, extra?: Record<string, number>) {
  if (!DEV || start === 0) return;
  const ms = (performance.now() - start).toFixed(1);
  const parts = [`[map-scene] ${label}: ${ms}ms`];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
  }
  // eslint-disable-next-line no-console
  console.debug(parts.join("  "));
}

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
      loadedPackId: null,
      refreshInFlight: false,
      contextLoading: false,
      three: null,
      threePromise: null,
      threeLoading: false,
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
      refreshRequestSeq: 0,
      majorLoadingCount: 0,
      majorLoadingMessage: null,
      activeScenePreset: null,
      initial3DCameraApplied: false,
      contextRoads: emptyFeatureCollection(),
      contextWater: emptyFeatureCollection(),
      contextGeneratedAt: new Date().toISOString(),
      contextAttribution: "OpenStreetMap contributors",
      theme:
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
          ? "dark"
          : "light",
    };
    sceneState.set(map, state);
  }
  return state;
}

function getSceneLoadingState(map: MLMap): SceneLoadingState {
  const state = getSceneState(map);
  return {
    threeLoading: state.threeLoading,
    contextLoading: state.contextLoading,
    majorLoading: state.majorLoadingCount > 0,
    majorLoadingMessage: state.majorLoadingMessage,
  };
}

function beginMajorLoading(map: MLMap, message?: string) {
  const state = getSceneState(map);
  state.majorLoadingCount += 1;
  if (message) state.majorLoadingMessage = message;
  emitSceneLoading(map);
}

function endMajorLoading(map: MLMap) {
  const state = getSceneState(map);
  state.majorLoadingCount = Math.max(0, state.majorLoadingCount - 1);
  if (state.majorLoadingCount === 0) state.majorLoadingMessage = null;
  emitSceneLoading(map);
}

function emitSceneLoading(map: MLMap) {
  if (typeof window === "undefined") return;
  const listeners = sceneLoadingListeners.get(map);
  if (!listeners || listeners.size === 0) return;
  const payload = getSceneLoadingState(map);
  for (const listener of listeners) listener(payload);
}

export function subscribeSceneLoading(
  map: MLMap,
  listener: SceneLoadingListener,
): () => void {
  let listeners = sceneLoadingListeners.get(map);
  if (!listeners) {
    listeners = new Set<SceneLoadingListener>();
    sceneLoadingListeners.set(map, listeners);
  }
  listeners.add(listener);
  listener(getSceneLoadingState(map));
  return () => {
    const current = sceneLoadingListeners.get(map);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) sceneLoadingListeners.delete(map);
  };
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
  const empty = emptyFeatureCollection();
  for (const id of CONTEXT_SOURCE_IDS) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: empty });
    }
  }
}

function ensureHillshadeLayer(map: MLMap) {
  if (map.getLayer("lyr-terrain-hillshade")) return;
  map.addLayer(
    {
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
    },
    layerBeforeBasemapLabels(map),
  );
}

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
  const beforeId = layerBeforeBasemapLabels(map);
  if (!map.getLayer("lyr-osm-roads")) {
    map.addLayer(
      {
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
      },
      beforeId,
    );
  }

  // Non-destructive flood highlight overlay (filters to floodLevel-tagged
  // segments). The base road layer keeps its default roadClass paint so
  // sparse-flood regions never look empty.
  if (!map.getLayer("lyr-osm-roads-flood")) {
    map.addLayer(
      {
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
      },
      beforeId,
    );
  }

  if (!map.getLayer("lyr-osm-water-flood")) {
    map.addLayer(
      {
        id: "lyr-osm-water-flood",
        type: "fill",
        source: "osm-context-water",
        filter: ["!=", ["coalesce", ["get", "floodLevel"], ""], ""],
        layout: {
          visibility: "none",
        },
        paint: {
          "fill-color": FLOOD_LEVEL_COLOR_EXPR as unknown as maplibregl.DataDrivenPropertyValueSpecification<string>,
          "fill-opacity": 0.32,
          "fill-outline-color": "#8ec5ff",
        },
      },
      beforeId,
    );
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
 * Toggle flood-impact highlighting for the 2D roads, water and 3D buildings.
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
  if (map.getLayer("lyr-osm-water-flood")) {
    map.setLayoutProperty(
      "lyr-osm-water-flood",
      "visibility",
      active ? "visible" : "none",
    );
  }

  state.three?.setFloodHighlight(active);
}

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
 */
export function setSceneAnimationsEnabled(map: MLMap, enabled: boolean) {
  const state = getSceneState(map);
  state.animationsEnabled = enabled;
  state.three?.setAnimationsEnabled(enabled);
}

export function beginSceneMajorLoading(map: MLMap, message?: string): void {
  beginMajorLoading(map, message);
}

export function endSceneMajorLoading(map: MLMap): void {
  endMajorLoading(map);
}

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
 * Lazy-create the Three.js custom layer on first 3D entry. Idempotent; seeds
 * the layer with cached payloads so the scene looks correct immediately.
 */
async function ensureThreeSceneLayer(
  map: MLMap,
): Promise<ThreeSceneHandle | null> {
  const state = getSceneState(map);
  if (state.three) return state.three;
  if (state.threePromise) return state.threePromise;

  state.threeLoading = true;
  emitSceneLoading(map);
  state.threePromise = (async () => {
    try {
      const mod = await import("@/services/three-scene");
      const handle = mod.createThreeSceneLayer(state.mapRef);
      if (!map.getLayer("lyr-three-scene")) {
        map.addLayer(handle.layer, layerBeforeBasemapLabels(map));
      }
      state.three = handle;
      syncThreeHandleFromState(map, handle);
      return handle;
    } catch {
      return null;
    } finally {
      state.threePromise = null;
      state.threeLoading = false;
      emitSceneLoading(map);
    }
  })();
  return state.threePromise;
}

const FACILITY_HIT_CIRCLE_RADIUS: maplibregl.DataDrivenPropertyValueSpecification<number> =
  [
    "interpolate",
    ["linear"],
    ["zoom"],
    11,
    10,
    13,
    12,
    15,
    16,
    17,
    18,
  ];

function ensureFacilityHitLayer(map: MLMap) {
  if (!map.getLayer(FACILITY_HIT_LAYER_ID)) {
    map.addLayer(
      {
        id: FACILITY_HIT_LAYER_ID,
        type: "circle",
        source: FACILITY_POINTS_SOURCE_ID,
        minzoom: 11,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": FACILITY_HIT_CIRCLE_RADIUS,
          "circle-opacity": 0,
        },
      },
      layerBeforeBasemapLabels(map),
    );
    return;
  }
  map.setPaintProperty(
    FACILITY_HIT_LAYER_ID,
    "circle-radius",
    FACILITY_HIT_CIRCLE_RADIUS,
  );
}

function ensureFacilityInteractions(map: MLMap) {
  if (facilityInteractionsBound.has(map)) return;

  const onMouseMove = (event: maplibregl.MapMouseEvent) => {
    const state = getSceneState(map);
    if (!state.sceneVisibility["critical-facilities"]) {
      closeFacilityPopup(map);
      map.getCanvas().style.cursor = "";
      return;
    }
    const pitch = map.getPitch();
    const pad =
      pitch >= 50 ? 18 : pitch >= 30 ? 12 : pitch >= 10 ? 8 : 0;
    const features =
      pad > 0
        ? map.queryRenderedFeatures(
            [
              [event.point.x - pad, event.point.y - pad],
              [event.point.x + pad, event.point.y + pad],
            ],
            { layers: [FACILITY_HIT_LAYER_ID] },
          )
        : map.queryRenderedFeatures(event.point, {
            layers: [FACILITY_HIT_LAYER_ID],
          });
    const hit = features[0] ?? null;
    if (hit?.geometry?.type === "Point") {
      const coordinates = hit.geometry.coordinates as [number, number];
      openFacilityHoverPopup(
        map,
        coordinates,
        hit.properties ?? {},
        state.theme,
      );
      map.getCanvas().style.cursor = "pointer";
    } else {
      closeFacilityPopup(map);
      map.getCanvas().style.cursor = "";
    }
  };

  map.on("mousemove", onMouseMove);

  const dispose = () => {
    map.off("mousemove", onMouseMove);
    closeFacilityPopup(map);
    map.getCanvas().style.cursor = "";
  };
  map.once("remove", dispose);

  facilityInteractionsBound.add(map);
}


function ensureSceneLayers(map: MLMap) {
  ensureTerrainSource(map);
  ensureContextSources(map);
  ensureHillshadeLayer(map);
  ensureRoadLayer(map);
  ensureFacilityHitLayer(map);
  // Three.js custom layer (`lyr-three-scene`) is created lazily on first
  // 3D entry — it owns building extrusions, facility pins, and flood decals.
  ensureFacilityInteractions(map);
}

function setSourceData(map: MLMap, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

function isLngInBounds(lng: number, west: number, east: number): boolean {
  if (west <= east) return lng >= west && lng <= east;
  return lng >= west || lng <= east;
}

function filterFacilitiesInView(map: MLMap, facilities: FacilityFeature[]): FacilityFeature[] {
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  return facilities.filter((feature) => {
    if (feature.geometry.type !== "Point") return false;
    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    return lat >= south && lat <= north && isLngInBounds(lon, west, east);
  });
}

function syncVisibleFacilityPointsSource(
  map: MLMap,
  facilities: FacilityFeature[] = getSceneState(map).lastFacilities,
) {
  const visible = filterFacilitiesInView(map, facilities);
  setSourceData(map, FACILITY_POINTS_SOURCE_ID, {
    type: "FeatureCollection",
    features: visible as GeoJSON.Feature[],
  });
  closeFacilityPopup(map);
}

/**
 * Load the static scene pack for the active preset and push it to Three.js
 * + the MapLibre context layers. No live Overpass; static packs cover all
 * supported cities (NCR, Bicol, Eastern Visayas, Cebu, Davao). If no preset
 * matches the current viewport the scene is cleared.
 */
async function refreshOsmContext(map: MLMap) {
  const t0 = perfStart();
  const state = getSceneState(map);
  if (state.refreshInFlight) return;

  const presetId = state.activeScenePreset ?? nearestScenePreset(map);
  if (!presetId) {
    clearSceneContext(map);
    return;
  }

  if (presetId === state.loadedPackId) {
    state.contextLoading = false;
    emitSceneLoading(map);
    return;
  }

  const requestSeq = ++state.refreshRequestSeq;
  state.refreshInFlight = true;
  state.contextLoading = true;
  emitSceneLoading(map);
  try {
    const payload = await fetchStaticContextPack(presetId);
    if (requestSeq !== state.refreshRequestSeq) return;
    if (!payload) {
      emitSceneStatus("Unable to load 3D scene pack. Showing last-known scene.");
      return;
    }

    state.loadedPackId = presetId;
    const buildings = payload.buildings.features as BuildingFeature[];
    const facilities = payload.facilities.features as FacilityFeature[];
    state.lastBuildings = buildings;
    state.lastFacilities = facilities;
    state.contextRoads = payload.roads;
    state.contextWater = payload.water;
    state.contextGeneratedAt = payload.generatedAt;
    state.contextAttribution = payload.attribution;

    setSourceData(map, "osm-context-roads", payload.roads);
    setSourceData(map, "osm-context-water", payload.water);
    syncVisibleFacilityPointsSource(map, facilities);

    state.three?.setBuildings(buildings);
    state.three?.setFacilities(facilities);

    emitSceneSummary(payload);
    emitSceneStatus(null);
  } catch {
    if (requestSeq !== state.refreshRequestSeq) return;
    emitSceneStatus("Unable to refresh 3D context. Showing last-known scene.");
  } finally {
    state.refreshInFlight = false;
    state.contextLoading = false;
    emitSceneLoading(map);
    perfEnd("refreshOsmContext", t0);
  }
}

function setLayerVisibility(map: MLMap, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

/** Restore scene layers after a basemap `setStyle` reload. */
export function reattachSceneAfterStyleChange(map: MLMap) {
  const state = getSceneState(map);
  state.three = null;
  state.threePromise = null;

  ensureSceneLayers(map);

  if (state.contextRoads.features.length > 0) {
    setSourceData(map, "osm-context-roads", state.contextRoads);
    setSourceData(map, "osm-context-water", state.contextWater);
    syncVisibleFacilityPointsSource(map);
  }

  for (const id of Object.keys(state.sceneVisibility) as SceneLayerId[]) {
    setSceneLayerVisibility(map, id, state.sceneVisibility[id]);
  }

  if (state.floodImpactActive) {
    setFloodImpactHighlight(map, true);
  }

  if (state.terrainEnabled) {
    applyTerrainExaggerationForCurrentZoom(map);
    void ensureThreeSceneLayer(map);
  }
}

function easeTo3DView(map: MLMap) {
  map.easeTo({
    pitch: 62,
    bearing: -18,
    zoom: Math.max(map.getZoom(), 8.2),
    duration: 800,
    essential: true,
  });
}

async function applyInitial3DCamera(map: MLMap) {
  const state = getSceneState(map);

  if (state.initial3DCameraApplied) {
    const presetId = nearestScenePreset(map);
    if (presetId) setActiveScenePreset(map, presetId);
    easeTo3DView(map);
    return;
  }

  state.initial3DCameraApplied = true;

  const presetId = nearestScenePreset(map);
  if (presetId) setActiveScenePreset(map, presetId);
  easeTo3DView(map);
}

export function initMapScene(map: MLMap) {
  ensureSceneLayers(map);
  setMapSceneTheme(map, "light");
  setTerrainExaggeration(map, DEFAULT_TERRAIN_EXAGGERATION);
  setSceneLayerVisibility(map, "hillshade", false);
  setSceneLayerVisibility(map, "roads", false);
  setSceneLayerVisibility(map, "buildings", false);
  setSceneLayerVisibility(map, "critical-facilities", true);
  void refreshOsmContext(map);

  // Pause facility-pin / flood-pulse animations during camera motion (their
  // per-frame `triggerRepaint` is wasted compute while MapLibre is already
  // animating).
  let motionPausedAnimations = false;
  const onMoveStart = () => {
    const state = getSceneState(map);
    if (!state.animationsEnabled) return;
    if (!state.three) return;
    state.three.setAnimationsEnabled(false);
    motionPausedAnimations = true;
  };
  const onMoveEnd = () => {
    if (motionPausedAnimations) {
      const state = getSceneState(map);
      if (state.animationsEnabled) {
        state.three?.setAnimationsEnabled(true);
      }
      motionPausedAnimations = false;
    }
    syncVisibleFacilityPointsSource(map);
  };
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);

  const onZoomEnd = () => {
    applyTerrainExaggerationForCurrentZoom(map);
  };
  map.on("zoomend", onZoomEnd);

  if (typeof map.once === "function") {
    map.once("remove", () => {
      motionPausedAnimations = false;
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onZoomEnd);
    });
  }
}

export function setMapSceneTheme(map: MLMap, theme: SceneTheme) {
  const state = getSceneState(map);
  if (state.theme === theme) return;
  state.theme = theme;

  if (map.getLayer("lyr-terrain-hillshade")) {
    map.setPaintProperty(
      "lyr-terrain-hillshade",
      "hillshade-shadow-color",
      theme === "dark" ? "#05080c" : "#b8c8d8",
    );
    map.setPaintProperty(
      "lyr-terrain-hillshade",
      "hillshade-highlight-color",
      theme === "dark" ? "#2a3a4a" : "#f4fbff",
    );
    map.setPaintProperty(
      "lyr-terrain-hillshade",
      "hillshade-accent-color",
      theme === "dark" ? "#1a2834" : "#d8e8f4",
    );
  }

  refreshFacilityPopupTheme(map, theme);
}

export function applyMapViewMode(map: MLMap, mode: "2d" | "3d") {
  const t0 = perfStart();
  const is3D = mode === "3d";

  if (is3D) {
    map.setMinZoom(MIN_ZOOM);
    map.setMaxBounds(PH_MAX_BOUNDS);
    beginMajorLoading(map, "Loading 3D terrain and critical facilities...");
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    setTerrainEnabled(map, true);
    void ensureThreeSceneLayer(map).finally(() => {
      endMajorLoading(map);
    });

    const state = getSceneState(map);
    if (!state.activeScenePreset) {
      void applyInitial3DCamera(map);
    } else {
      easeTo3DView(map);
    }
  } else {
    map.setMinZoom(MAP_2D_MIN_ZOOM);
    map.setMaxBounds(MAP_2D_MAX_BOUNDS);
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

  notifyMapViewModeForSatelliteImagery(map, mode);
  notifyLiveWeatherMapMode(map, mode);
  perfEnd("applyMapViewMode", t0, { mode3d: is3D ? 1 : 0 });
}

export function setTerrainEnabled(map: MLMap, enabled: boolean) {
  const state = getSceneState(map);
  state.terrainEnabled = enabled;
  if (enabled) {
    ensureTerrainSource(map);
    applyTerrainExaggerationForCurrentZoom(map);
    return;
  }
  (map as TerrainCapableMap).setTerrain(null);
}

export function setTerrainExaggeration(map: MLMap, exaggeration: number) {
  const state = getSceneState(map);
  state.terrainExaggeration = exaggeration;
  if (!state.terrainEnabled) return;
  applyTerrainExaggerationForCurrentZoom(map);
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
    if (!visible) closeFacilityPopup(map);
  }
}

export const SCENE_LAYERS: Array<{
  id: SceneLayerId;
  label: string;
  swatch: string;
}> = [
  { id: "hillshade", label: "Terrain Shading", swatch: "#1f4f63" },
  { id: "roads", label: "Road Network", swatch: "#ffb347" },
  { id: "buildings", label: "Building Context", swatch: "#a8b3c2" },
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
    id: "naga",
    label: "Naga",
    // Naga City, Camarines Sur. Has its own dedicated static pack so the
    // 180-facility / 3000-building budget is concentrated on Naga rather
    // than diluted across the wider Bicol region.
    center: [123.1944, 13.6218] as [number, number],
    zoom: 13.4,
    pitch: 62,
    bearing: -18,
  },
  {
    id: "bicol",
    label: "Bicol",
    // Wider Bicol coverage centred near Legazpi for users looking at the
    // Albay / Sorsogon corridor. Naga has its own quick view above.
    center: [123.55, 13.3] as [number, number],
    zoom: 9.6,
    pitch: 60,
    bearing: -16,
  },
  {
    id: "eastern-visayas",
    label: "Visayas",
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

/** Fallback scene pack when the viewport is not near any preset centre. */
export const DEFAULT_3D_PRESET: ScenePresetId = "ncr";

export function setActiveScenePreset(map: MLMap, presetId: ScenePresetId | null) {
  const state = getSceneState(map);
  if (state.activeScenePreset === presetId) return;
  state.activeScenePreset = presetId;
  if (presetId) {
    const preset = SCENE_PRESETS.find((p) => p.id === presetId);
    const label = preset?.label ?? presetId;
    beginMajorLoading(map, `Loading ${label} scene pack...`);
  }
  void refreshOsmContext(map).finally(() => {
    if (presetId) endMajorLoading(map);
  });
}

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
  if (state) {
    state.lastBuildings = [];
    state.lastFacilities = [];
    state.loadedPackId = null;
    state.contextRoads = empty;
    state.contextWater = empty;
    state.contextGeneratedAt = new Date().toISOString();
    state.contextAttribution = "No static scene pack loaded";
    state.three?.setBuildings([]);
    state.three?.setFacilities([]);
    closeFacilityPopup(map);
  }
  emitSceneSummary({
    buildings: empty,
    roads: empty,
    water: empty,
    facilities: empty,
    generatedAt: new Date().toISOString(),
    attribution: "No static scene pack loaded",
  });
}

/** Threshold (degrees) within which a coordinate is treated as "inside" a preset's coverage. */
const SCENE_PRESET_MATCH_DEGREES = 2.5;

function nearestScenePresetTo(lon: number, lat: number): ScenePresetId | null {
  let best: { id: ScenePresetId; distance: number } | null = null;
  for (const preset of SCENE_PRESETS) {
    const distance = Math.hypot(lon - preset.center[0], lat - preset.center[1]);
    if (!best || distance < best.distance) {
      best = { id: preset.id, distance };
    }
  }
  return best && best.distance < SCENE_PRESET_MATCH_DEGREES ? best.id : null;
}

function nearestScenePreset(map: MLMap): ScenePresetId | null {
  const c = map.getCenter();
  return nearestScenePresetTo(c.lng, c.lat);
}

async function fetchStaticContextPack(
  presetId: ScenePresetId | null,
): Promise<OsmContextPayload | null> {
  if (!presetId) return null;
  const response = await fetch(`/osm-context/${presetId}.json?v=${SCENE_PACK_VERSION}`, {
    cache: "force-cache",
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as OsmContextPayload;
  return isOsmContextPayload(payload) ? payload : null;
}

/**
 * Fly the camera to an address inside one of our preset coverages and ensure
 * its static scene pack is loaded. No live Overpass, no synthesised pin: the
 * Three.js layer's facility pins + building extrusions handle "what's there".
 */
export async function focusAddress3DContext(
  map: MLMap,
  target: Address3DTarget,
): Promise<void> {
  const presetId = nearestScenePresetTo(target.lon, target.lat);
  if (!presetId) {
    emitSceneStatus("Selected location is outside the supported scene packs.");
    return;
  }

  beginMajorLoading(map, "Loading focused 3D context...");
  try {
    setActiveScenePreset(map, presetId);
    map.flyTo({
      center: [target.lon, target.lat],
      zoom: target.zoom ?? 15.5,
      pitch: 62,
      bearing: -18,
      duration: 1400,
      essential: true,
    });
    emitSceneStatus(null);
  } finally {
    endMajorLoading(map);
  }
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
