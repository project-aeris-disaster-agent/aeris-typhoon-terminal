import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import { notifyMapViewModeForSatelliteImagery } from "@/services/satellite-frames";
import { notifyLiveWeatherMapMode } from "@/services/live-weather-overlay";
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

type BBox = [west: number, south: number, east: number, north: number];
type SceneTheme = "light" | "dark";
export type BuildingRenderScope = "context" | "facility-only";

export type Address3DTarget = {
  lat: number;
  lon: number;
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
export type SceneLoadingState = {
  threeLoading: boolean;
  contextLoading: boolean;
  majorLoading: boolean;
  majorLoadingMessage: string | null;
};
type SceneLoadingListener = (state: SceneLoadingState) => void;

export const DEFAULT_SCENE_VISIBILITY: Record<SceneLayerId, boolean> = {
  hillshade: true,
  roads: true,
  buildings: false,
  "critical-facilities": true,
};

export const DEFAULT_TERRAIN_EXAGGERATION = 1.35;
const SCENE_PACK_VERSION = "2026-04-24-11-flood-water-tag-ev";
const FACILITY_LABEL_SOURCE_ID = "osm-context-facility-labels";
const CONTEXT_SOURCE_IDS = [
  "osm-context-buildings",
  "osm-context-roads",
  "osm-context-water",
  "osm-context-facilities",
  FACILITY_LABEL_SOURCE_ID,
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
  contextLoading: boolean;
  three: ThreeSceneHandle | null;
  threePromise: Promise<ThreeSceneHandle | null> | null;
  threeLoading: boolean;
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
  buildingRenderScope: BuildingRenderScope;
  animationsEnabled: boolean;
  refreshRequestSeq: number;
  focusRequestSeq: number;
  lastLiveContextKey: string | null;
  lastStaticBuildings: BuildingFeature[];
  lastStaticFacilities: FacilityFeature[];
  lastLiveBuildings: BuildingFeature[];
  lastLiveFacilities: FacilityFeature[];
  pinnedBuilding: BuildingFeature | null;
  majorLoadingCount: number;
  majorLoadingMessage: string | null;
  activeScenePreset: ScenePresetId | null;
  quickViewLoadStartMs: number | null;
  quickViewSetBuildingsCount: number;
  quickViewAppendBuildingsCount: number;
  quickViewAmbientBatchCount: number;
  quickViewFirstRenderLogged: boolean;
  progressiveHydrationTimer: ReturnType<typeof setTimeout> | null;
  progressiveLoading: boolean;
  contextRoads: GeoJSON.FeatureCollection;
  contextWater: GeoJSON.FeatureCollection;
  contextGeneratedAt: string;
  contextAttribution: string;
  theme: SceneTheme;
};

const sceneState = new WeakMap<MLMap, SceneState>();
const sceneLoadingListeners = new WeakMap<MLMap, Set<SceneLoadingListener>>();

const DEV = process.env.NODE_ENV === "development";
function perfStart(label: string): number {
  if (!DEV) return 0;
  return performance.now();
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
      lastContextKey: null,
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
      buildingRenderScope: "context",
      animationsEnabled: true,
      refreshRequestSeq: 0,
      focusRequestSeq: 0,
      lastLiveContextKey: null,
      lastStaticBuildings: [],
      lastStaticFacilities: [],
      lastLiveBuildings: [],
      lastLiveFacilities: [],
      pinnedBuilding: null,
      majorLoadingCount: 0,
      majorLoadingMessage: null,
      activeScenePreset: null,
      quickViewLoadStartMs: null,
      quickViewSetBuildingsCount: 0,
      quickViewAppendBuildingsCount: 0,
      quickViewAmbientBatchCount: 0,
      quickViewFirstRenderLogged: false,
      progressiveHydrationTimer: null,
      progressiveLoading: false,
      contextRoads: emptyFeatureCollection(),
      contextWater: emptyFeatureCollection(),
      contextGeneratedAt: new Date().toISOString(),
      contextAttribution: "OpenStreetMap contributors",
      theme: "dark",
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

function cancelProgressiveHydration(state: SceneState) {
  const hadTimer = Boolean(state.progressiveHydrationTimer);
  if (state.progressiveHydrationTimer) {
    clearTimeout(state.progressiveHydrationTimer);
    state.progressiveHydrationTimer = null;
  }
  state.progressiveLoading = false;
  if (hadTimer && state.mapRef.current) {
    emitSceneLoading(state.mapRef.current);
  }
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

  // Flood-highlighted contextual water bodies. This mirrors the roads flood
  // overlay semantics so hazard level filters can consistently target both
  // transport corridors and nearby waterways.
  if (!map.getLayer("lyr-osm-water-flood")) {
    map.addLayer({
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

export function setBuildingRenderScope(map: MLMap, scope: BuildingRenderScope) {
  const state = getSceneState(map);
  if (state.buildingRenderScope === scope) return;
  state.buildingRenderScope = scope;
  void refreshOsmContext(map);
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
  if (map.getLayer("lyr-osm-water-flood")) {
    map.setLayoutProperty(
      "lyr-osm-water-flood",
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

  state.threeLoading = true;
  emitSceneLoading(map);
  state.threePromise = (async () => {
    try {
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

function ensureFacilityLabelLayer(map: MLMap) {
  if (map.getLayer("lyr-osm-facility-labels")) return;
  map.addLayer({
    id: "lyr-osm-facility-labels",
    type: "symbol",
    source: FACILITY_LABEL_SOURCE_ID,
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
      // Aligned with 3D facility fill: ~30% more transparent than 0.92
      "text-opacity": 0.92 * 0.7,
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

function isLngInBounds(lng: number, west: number, east: number): boolean {
  if (west <= east) return lng >= west && lng <= east;
  // Antimeridian-safe wrap-around check for [west, east] spans.
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

function syncVisibleFacilityLabelSource(
  map: MLMap,
  facilities: FacilityFeature[] = getSceneState(map).lastFacilities,
) {
  const visibleFacilities = filterFacilitiesInView(map, facilities);
  setSourceData(map, FACILITY_LABEL_SOURCE_ID, {
    type: "FeatureCollection",
    features: visibleFacilities as GeoJSON.Feature[],
  });
}

async function refreshOsmContext(map: MLMap) {
  const t0 = perfStart("refreshOsmContext");
  const state = getSceneState(map);
  if (state.refreshInFlight) return;
  cancelProgressiveHydration(state);

  const zoom = map.getZoom();
  if (zoom < 10) {
    state.contextLoading = false;
    emitSceneLoading(map);
    clearSceneContext(map);
    state.lastContextKey = null;
    return;
  }

  const presetId = state.activeScenePreset ?? nearestScenePreset(map);
  const nextLiveBbox = state.activeScenePreset ? null : getViewportFetchBbox(map);
  const nextLiveKey = nextLiveBbox?.map((value) => value.toFixed(4)).join(",") ?? null;
  if (presetId === state.lastContextKey && nextLiveKey === state.lastLiveContextKey) {
    state.contextLoading = false;
    emitSceneLoading(map);
    return;
  }

  const requestSeq = ++state.refreshRequestSeq;
  state.refreshInFlight = true;
  state.contextLoading = true;
  emitSceneLoading(map);
  try {
    const fetchT0 = perfStart("refreshOsmContext.fetch");
    const [staticPayload, livePayload] = state.activeScenePreset
      ? await Promise.all([fetchStaticContextPack(state.activeScenePreset), Promise.resolve(null)])
      : await Promise.all([
          fetchStaticContextPack(presetId),
          nextLiveBbox ? fetchLiveContext(nextLiveBbox, map.getZoom()) : Promise.resolve(null),
        ]);
    perfEnd("refreshOsmContext.fetch", fetchT0, {
      hasStatic: staticPayload ? 1 : 0,
      hasLive: livePayload ? 1 : 0,
    });
    if (requestSeq !== state.refreshRequestSeq) return;

    if (staticPayload) {
      state.lastContextKey = presetId;
      state.lastStaticBuildings = staticPayload.buildings.features as BuildingFeature[];
      state.lastStaticFacilities = staticPayload.facilities.features as FacilityFeature[];
      setSourceData(map, "osm-context-roads", staticPayload.roads);
      setSourceData(map, "osm-context-water", staticPayload.water);
      state.contextRoads = staticPayload.roads;
      state.contextWater = staticPayload.water;
      state.contextGeneratedAt = staticPayload.generatedAt;
      state.contextAttribution = staticPayload.attribution;
    } else {
      state.lastContextKey = null;
      state.lastStaticBuildings = [];
      state.lastStaticFacilities = [];
      setSourceData(
        map,
        "osm-context-roads",
        livePayload?.roads ?? emptyFeatureCollection(),
      );
      setSourceData(
        map,
        "osm-context-water",
        livePayload?.water ?? emptyFeatureCollection(),
      );
      state.contextRoads = livePayload?.roads ?? emptyFeatureCollection();
      state.contextWater = livePayload?.water ?? emptyFeatureCollection();
      state.contextGeneratedAt = livePayload?.generatedAt ?? new Date().toISOString();
      state.contextAttribution = livePayload?.attribution ?? "OpenStreetMap contributors";
    }

    if (livePayload) {
      state.lastLiveContextKey = nextLiveKey;
      state.lastLiveBuildings = livePayload.buildings.features as BuildingFeature[];
      state.lastLiveFacilities = livePayload.facilities.features as FacilityFeature[];
    } else {
      state.lastLiveContextKey = null;
      state.lastLiveBuildings = [];
      state.lastLiveFacilities = [];
    }
    const fullBuildings = mergeUniqueBuildings(
      state.lastStaticBuildings,
      state.lastLiveBuildings,
    );
    const fullFacilities = mergeUniqueFacilities(
      state.lastStaticFacilities,
      state.lastLiveFacilities,
    );
    const selection = selectSceneBuildings(
      fullBuildings,
      fullFacilities,
      state.pinnedBuilding ? [state.pinnedBuilding] : [],
      state.buildingRenderScope,
      { lon: map.getCenter().lng, lat: map.getCenter().lat },
    );

    // Render only important-facility context immediately; hydrate ambient
    // buildings progressively to avoid one large rebuild pass.
    state.lastStaticBuildings = [];
    state.lastStaticFacilities = [];
    state.lastLiveBuildings = selection.immediateBuildings;
    state.lastLiveFacilities = selection.facilities;
    applyComposedSceneData(map, staticPayload, livePayload);
    if (shouldScheduleAmbientHydration(state.buildingRenderScope, selection.deferredBuildings.length)) {
      scheduleProgressiveLiveBuildings(
        map,
        "refresh",
        requestSeq,
        selection.deferredBuildings,
      );
    }
    emitSceneStatus(null);
  } catch {
    if (requestSeq !== state.refreshRequestSeq) return;
    emitSceneStatus("Unable to refresh live 3D context.");
    state.lastLiveContextKey = null;
    state.lastLiveBuildings = [];
    state.lastLiveFacilities = [];
    applyComposedSceneData(map, null, null);
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

export function initMapScene(map: MLMap) {
  ensureSceneLayers(map);
  setMapSceneTheme(map, "light");
  setTerrainExaggeration(map, DEFAULT_TERRAIN_EXAGGERATION);
  setSceneLayerVisibility(map, "hillshade", true);
  setSceneLayerVisibility(map, "roads", true);
  setSceneLayerVisibility(map, "buildings", false);
  setSceneLayerVisibility(map, "critical-facilities", true);
  void refreshOsmContext(map);

  // Debounce `moveend` refetches: users frequently pan-drag-pan-drag, and
  // each `moveend` would otherwise re-evaluate the scene preset and kick
  // off a potentially megabyte-sized pack download. Wait 500ms of quiet
  // before actually refreshing, so rapid pan sequences collapse into one
  // final fetch.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
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
    // Keep label rendering scoped to the current viewport so we do not
    // place every facility name in one pass after each context refresh.
    syncVisibleFacilityLabelSource(map);
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshOsmContext(map);
    }, 500);
  };
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);

  if (typeof map.once === "function") {
    map.once("remove", () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      motionPausedAnimations = false;
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
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

  if (map.getLayer("lyr-osm-facility-labels")) {
    map.setPaintProperty(
      "lyr-osm-facility-labels",
      "text-color",
      theme === "dark" ? "#e6edf3" : "#12314a",
    );
    map.setPaintProperty(
      "lyr-osm-facility-labels",
      "text-halo-color",
      theme === "dark" ? "#081017" : "#f8fbff",
    );
  }
}

export function applyMapViewMode(map: MLMap, mode: "2d" | "3d") {
  const t0 = perfStart("applyMapViewMode");
  const is3D = mode === "3d";

  if (is3D) {
    const t3dLayer = perfStart("applyMapViewMode.3d.ensureThreeSceneLayer");
    beginMajorLoading(map, "Loading 3D terrain and critical facilities...");
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    setTerrainEnabled(map, true);
    // Kick off the Three.js layer load on first 3D entry. Fire-and-forget —
    // the promise resolves asynchronously; meanwhile the camera flight is
    // already underway so the user sees terrain + pitch immediately.
    void ensureThreeSceneLayer(map).finally(() => {
      endMajorLoading(map);
      perfEnd("applyMapViewMode.3d.ensureThreeSceneLayer", t3dLayer);
    });
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

  notifyMapViewModeForSatelliteImagery(map, mode);
  notifyLiveWeatherMapMode(map, mode);
  perfEnd("applyMapViewMode", t0, { mode3d: is3D ? 1 : 0 });
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

export function setActiveScenePreset(map: MLMap, presetId: ScenePresetId | null) {
  const state = getSceneState(map);
  if (state.activeScenePreset === presetId) return;
  state.activeScenePreset = presetId;
  if (presetId) {
    state.buildingRenderScope = "facility-only";
    state.quickViewLoadStartMs = performance.now();
    state.quickViewSetBuildingsCount = 0;
    state.quickViewAppendBuildingsCount = 0;
    state.quickViewAmbientBatchCount = 0;
    state.quickViewFirstRenderLogged = false;
    beginMajorLoading(map, `Loading critical 3D buildings for ${presetId}...`);
  } else {
    state.buildingRenderScope = "context";
    state.quickViewLoadStartMs = null;
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
    cancelProgressiveHydration(state);
    state.lastBuildings = [];
    state.lastFacilities = [];
    state.lastStaticBuildings = [];
    state.lastStaticFacilities = [];
    state.lastLiveBuildings = [];
    state.lastLiveFacilities = [];
    state.lastLiveContextKey = null;
    state.pinnedBuilding = null;
    state.contextRoads = empty;
    state.contextWater = empty;
    state.contextGeneratedAt = new Date().toISOString();
    state.contextAttribution = "No static scene pack loaded";
    state.three?.setBuildings([]);
    state.three?.setFacilities([]);
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

function getViewportFetchBbox(map: MLMap): BBox | null {
  const center = map.getCenter();
  const bounds = map.getBounds();
  const width = Math.max(0.03, Math.min(0.35, Math.abs(bounds.getEast() - bounds.getWest())));
  const height = Math.max(0.03, Math.min(0.3, Math.abs(bounds.getNorth() - bounds.getSouth())));
  return makeClampedBbox(center.lng, center.lat, width / 2, height / 2);
}

function makeClampedBbox(
  lon: number,
  lat: number,
  halfWidth: number,
  halfHeight: number,
): BBox | null {
  const minLon = PH_BBOX[0];
  const minLat = PH_BBOX[1];
  const maxLon = PH_BBOX[2];
  const maxLat = PH_BBOX[3];

  const west = Math.max(minLon, lon - halfWidth);
  const east = Math.min(maxLon, lon + halfWidth);
  const south = Math.max(minLat, lat - halfHeight);
  const north = Math.min(maxLat, lat + halfHeight);

  if (!(west < east && south < north)) return null;
  return [west, south, east, north];
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

async function fetchLiveContext(
  bbox: BBox,
  zoom: number,
): Promise<OsmContextPayload | null> {
  const bboxText = bbox.map((value) => value.toFixed(5)).join(",");
  const response = await fetch(
    `/api/osm-context?bbox=${encodeURIComponent(bboxText)}&zoom=${encodeURIComponent(zoom.toFixed(2))}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as OsmContextPayload;
  return isOsmContextPayload(payload) ? payload : null;
}

function buildingKey(feature: BuildingFeature): string {
  const ring = feature.geometry.coordinates[0];
  const origin = ring?.[0] ?? [0, 0];
  const props = feature.properties ?? {};
  return [
    origin[0].toFixed(5),
    origin[1].toFixed(5),
    String(props.name ?? ""),
    String(props.kind ?? "building"),
  ].join("|");
}

function facilityKey(feature: FacilityFeature): string {
  const [lon, lat] = feature.geometry.coordinates;
  const props = feature.properties ?? {};
  return [
    lon.toFixed(5),
    lat.toFixed(5),
    String(props.name ?? ""),
    String(props.category ?? "other"),
  ].join("|");
}

function mergeUniqueBuildings(...lists: BuildingFeature[][]): BuildingFeature[] {
  const merged: BuildingFeature[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const feature of list) {
      const key = buildingKey(feature);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(feature);
    }
  }
  return merged;
}

function mergeUniqueFacilities(...lists: FacilityFeature[][]): FacilityFeature[] {
  const merged: FacilityFeature[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const feature of list) {
      const key = facilityKey(feature);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(feature);
    }
  }
  return merged;
}

const IMPORTANT_FACILITY_MIN_PRIORITY = 1;
const FACILITY_BUILDING_MATCH_DIST = 0.0012;
const AMBIENT_BUILDING_BUDGET = 900;

function importantFacilitiesOnly(
  facilities: FacilityFeature[],
  minPriority = IMPORTANT_FACILITY_MIN_PRIORITY,
): FacilityFeature[] {
  return facilities.filter((feature) => {
    const priority = feature.properties?.priority;
    return typeof priority === "number" ? priority >= minPriority : false;
  });
}

function centroidOfBuilding(feature: BuildingFeature): [number, number] {
  const ring = feature.geometry.coordinates[0] ?? [];
  if (ring.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
}

function bboxContains(
  ring: GeoJSON.Position[],
  lng: number,
  lat: number,
): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of ring) {
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  return lng >= minX && lng <= maxX && lat >= minY && lat <= maxY;
}

function pointInRing(
  ring: GeoJSON.Position[],
  lng: number,
  lat: number,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = (yi > lat) !== (yj > lat);
    const xIntersect = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses && lng < xIntersect) inside = !inside;
  }
  return inside;
}

function containsPoint(feature: BuildingFeature, lng: number, lat: number): boolean {
  const rings = feature.geometry.coordinates;
  const outer = rings[0];
  if (!outer || outer.length < 4) return false;
  if (!bboxContains(outer, lng, lat) || !pointInRing(outer, lng, lat)) return false;
  for (const hole of rings.slice(1)) {
    if (hole.length < 4) continue;
    if (bboxContains(hole, lng, lat) && pointInRing(hole, lng, lat)) return false;
  }
  return true;
}

function buildingByImportantFacilities(
  buildings: BuildingFeature[],
  facilities: FacilityFeature[],
): BuildingFeature[] {
  if (buildings.length === 0 || facilities.length === 0) return [];
  type IndexedBuilding = {
    building: BuildingFeature;
    ring: GeoJSON.Position[];
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    center: [number, number];
  };
  const cellSize = 0.003;
  const cells = new Map<string, IndexedBuilding[]>();
  const indexed: IndexedBuilding[] = [];
  const indexCell = (x: number, y: number) =>
    `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;
  for (const building of buildings) {
    const ring = building.geometry.coordinates[0];
    if (!ring || ring.length < 4) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const item: IndexedBuilding = {
      building,
      ring,
      bbox: { minX, minY, maxX, maxY },
      center: centroidOfBuilding(building),
    };
    indexed.push(item);
    for (
      let cx = Math.floor(minX / cellSize);
      cx <= Math.floor(maxX / cellSize);
      cx++
    ) {
      for (
        let cy = Math.floor(minY / cellSize);
        cy <= Math.floor(maxY / cellSize);
        cy++
      ) {
        const key = `${cx}:${cy}`;
        const list = cells.get(key);
        if (list) list.push(item);
        else cells.set(key, [item]);
      }
    }
  }

  const picked: BuildingFeature[] = [];
  const seen = new Set<string>();
  for (const facility of facilities) {
    const [fx, fy] = facility.geometry.coordinates;
    const candidateSet = new Set<IndexedBuilding>();
    const baseX = Math.floor(fx / cellSize);
    const baseY = Math.floor(fy / cellSize);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const list = cells.get(`${baseX + ox}:${baseY + oy}`);
        if (!list) continue;
        for (const item of list) candidateSet.add(item);
      }
    }
    const candidates =
      candidateSet.size > 0 ? Array.from(candidateSet) : indexed;
    let best =
      candidates.find((item) => {
        if (
          fx < item.bbox.minX ||
          fx > item.bbox.maxX ||
          fy < item.bbox.minY ||
          fy > item.bbox.maxY
        ) {
          return false;
        }
        return containsPoint(item.building, fx, fy);
      })?.building ?? null;
    let bestDistance = FACILITY_BUILDING_MATCH_DIST;
    if (!best) {
      for (const item of candidates) {
        const d = Math.hypot(fx - item.center[0], fy - item.center[1]);
        if (d < bestDistance) {
          bestDistance = d;
          best = item.building;
        }
      }
    }
    if (!best) continue;
    const key = buildingKey(best);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(best);
  }
  return picked;
}

export function selectSceneBuildingsForTest(
  buildings: BuildingFeature[],
  facilities: FacilityFeature[],
  pinnedBuildings: BuildingFeature[],
  scope: BuildingRenderScope,
  center: { lon: number; lat: number },
) {
  return selectSceneBuildings(buildings, facilities, pinnedBuildings, scope, center);
}

function selectSceneBuildings(
  buildings: BuildingFeature[],
  facilities: FacilityFeature[],
  pinnedBuildings: BuildingFeature[],
  scope: BuildingRenderScope,
  center: { lon: number; lat: number },
) {
  const priorityFacilities = importantFacilitiesOnly(facilities);
  const immediateBuildings = mergeUniqueBuildings(
    buildingByImportantFacilities(buildings, priorityFacilities),
    pinnedBuildings,
  );
  if (scope === "facility-only") {
    return {
      facilities: priorityFacilities,
      immediateBuildings,
      deferredBuildings: [],
    };
  }
  const immediateKeys = new Set(immediateBuildings.map((feature) => buildingKey(feature)));
  const deferredBuildings = buildings.filter(
    (feature) => !immediateKeys.has(buildingKey(feature)),
  );
  return {
    facilities: priorityFacilities,
    immediateBuildings,
    deferredBuildings: capAmbientBuildings(deferredBuildings, center),
  };
}

function capAmbientBuildings(
  buildings: BuildingFeature[],
  center: { lon: number; lat: number },
  budget = AMBIENT_BUILDING_BUDGET,
): BuildingFeature[] {
  if (buildings.length <= budget) return buildings;
  const ranked = buildings
    .map((building) => {
      const [lon, lat] = centroidOfBuilding(building);
      return {
        building,
        distance: Math.hypot(lon - center.lon, lat - center.lat),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  return ranked.slice(0, budget).map((item) => item.building);
}

async function waitForPriorityRender(map: MLMap): Promise<void> {
  const state = getSceneState(map);
  const handle = state.three;
  if (!handle) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 900));
  await Promise.race([handle.awaitNextRebuild(), timeout]);
}

function applyComposedSceneData(
  map: MLMap,
  staticPayload: OsmContextPayload | null,
  livePayload: OsmContextPayload | null,
  options?: {
    emitSummary?: boolean;
    updateMapSources?: boolean;
    pushThreeMode?: "replace" | "skip";
  },
) {
  const t0 = perfStart("applyComposedSceneData");
  const state = getSceneState(map);
  const buildings = mergeUniqueBuildings(
    state.lastStaticBuildings,
    state.lastLiveBuildings,
    state.pinnedBuilding ? [state.pinnedBuilding] : [],
  );
  const facilities = mergeUniqueFacilities(
    state.lastStaticFacilities,
    state.lastLiveFacilities,
  );
  state.lastBuildings = buildings;
  state.lastFacilities = facilities;

  if (options?.updateMapSources !== false) {
    setSourceData(map, "osm-context-buildings", {
      type: "FeatureCollection",
      features: buildings as GeoJSON.Feature[],
    });
    setSourceData(map, "osm-context-facilities", {
      type: "FeatureCollection",
      features: facilities as GeoJSON.Feature[],
    });
  }
  syncVisibleFacilityLabelSource(map, facilities);
  if (options?.pushThreeMode !== "skip") {
    state.quickViewSetBuildingsCount += 1;
    state.three?.setBuildings(buildings);
    state.three?.setFacilities(facilities);
    if (
      DEV &&
      state.activeScenePreset &&
      !state.quickViewFirstRenderLogged &&
      buildings.length > 0
    ) {
      state.quickViewFirstRenderLogged = true;
      const elapsed =
        state.quickViewLoadStartMs === null
          ? -1
          : Math.round(performance.now() - state.quickViewLoadStartMs);
      // eslint-disable-next-line no-console
      console.debug("[map-scene] quick-view-first-render", {
        preset: state.activeScenePreset,
        elapsedMs: elapsed,
        buildings: buildings.length,
        facilities: facilities.length,
        setBuildingsCalls: state.quickViewSetBuildingsCount,
        appendBuildingsCalls: state.quickViewAppendBuildingsCount,
        ambientBatchCount: state.quickViewAmbientBatchCount,
      });
    }
  }

  if (options?.emitSummary === false) {
    perfEnd("applyComposedSceneData", t0, {
      buildings: buildings.length,
      facilities: facilities.length,
    });
    return;
  }

  emitSceneSummary({
    buildings: {
      type: "FeatureCollection",
      features: buildings as GeoJSON.Feature[],
    },
    facilities: {
      type: "FeatureCollection",
      features: facilities as GeoJSON.Feature[],
    },
    roads: staticPayload?.roads ?? livePayload?.roads ?? state.contextRoads,
    water: staticPayload?.water ?? livePayload?.water ?? state.contextWater,
    generatedAt:
      livePayload?.generatedAt ?? staticPayload?.generatedAt ?? state.contextGeneratedAt,
    attribution:
      [staticPayload?.attribution, livePayload?.attribution]
        .filter(Boolean)
        .join(" + ") || state.contextAttribution,
  });
  perfEnd("applyComposedSceneData", t0, {
    buildings: buildings.length,
    facilities: facilities.length,
  });
}

function makePinnedBuildingFromPoint(lon: number, lat: number): BuildingFeature {
  const dx = 0.00008;
  const dy = 0.00008;
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [lon - dx, lat - dy],
        [lon + dx, lat - dy],
        [lon + dx, lat + dy],
        [lon - dx, lat + dy],
        [lon - dx, lat - dy],
      ]],
    },
    properties: {
      kind: "building",
      height: 12,
      minHeight: 0,
      name: "Selected location",
    },
  };
}

function nearestBuildingAtPoint(
  lon: number,
  lat: number,
  buildings: BuildingFeature[],
): BuildingFeature | null {
  let best: BuildingFeature | null = null;
  let bestDistance = Infinity;
  for (const building of buildings) {
    const ring = building.geometry.coordinates[0];
    if (!ring || ring.length === 0) continue;
    const [bx, by] = ring[0];
    const d = Math.hypot(lon - bx, lat - by);
    if (d < bestDistance) {
      best = building;
      bestDistance = d;
    }
  }
  return best;
}

const PROGRESSIVE_BUILDING_BATCH_SIZE = 260;
const PROGRESSIVE_BUILDING_BATCH_DELAY_MS = 120;
const PROGRESSIVE_SUMMARY_EVERY_BATCHES = 4;

function shouldScheduleAmbientHydration(
  scope: BuildingRenderScope,
  deferredCount: number,
): boolean {
  return scope === "context" && deferredCount > 0;
}

export function shouldScheduleAmbientHydrationForTest(
  scope: BuildingRenderScope,
  deferredCount: number,
): boolean {
  return shouldScheduleAmbientHydration(scope, deferredCount);
}

function scheduleProgressiveLiveBuildings(
  map: MLMap,
  owner: "refresh" | "focus",
  requestSeq: number,
  remainingBuildings: BuildingFeature[],
) {
  const t0 = perfStart("scheduleProgressiveLiveBuildings.total");
  const state = getSceneState(map);
  cancelProgressiveHydration(state);
  if (remainingBuildings.length === 0) return;
  state.progressiveLoading = true;
  emitSceneLoading(map);

  let index = 0;
  let batchNumber = 0;
  const step = () => {
    const batchT0 = perfStart("scheduleProgressiveLiveBuildings.batch");
    const liveState = getSceneState(map);
    const moving = typeof map.isMoving === "function" ? map.isMoving() : false;
    if (moving) {
      liveState.progressiveHydrationTimer = setTimeout(
        step,
        PROGRESSIVE_BUILDING_BATCH_DELAY_MS * 3,
      );
      perfEnd("scheduleProgressiveLiveBuildings.batch", batchT0, {
        deferredForMotion: 1,
      });
      return;
    }
    const activeSeq =
      owner === "refresh" ? liveState.refreshRequestSeq : liveState.focusRequestSeq;
    if (requestSeq !== activeSeq) {
      liveState.progressiveHydrationTimer = null;
      liveState.progressiveLoading = false;
      emitSceneLoading(map);
      perfEnd("scheduleProgressiveLiveBuildings.batch", batchT0, { stale: 1 });
      return;
    }
    const next = remainingBuildings.slice(index, index + PROGRESSIVE_BUILDING_BATCH_SIZE);
    if (next.length === 0) {
      liveState.progressiveHydrationTimer = null;
      liveState.progressiveLoading = false;
      applyComposedSceneData(map, null, null);
      emitSceneLoading(map);
      perfEnd("scheduleProgressiveLiveBuildings.batch", batchT0, { done: 1 });
      perfEnd("scheduleProgressiveLiveBuildings.total", t0, {
        batches: batchNumber,
      });
      return;
    }
    liveState.lastLiveBuildings = mergeUniqueBuildings(liveState.lastLiveBuildings, next);
    batchNumber += 1;
    const isFinalBatch = index + PROGRESSIVE_BUILDING_BATCH_SIZE >= remainingBuildings.length;
    // Append newly hydrated ambient buildings directly to Three.js to avoid
    // re-sending the whole composed building list every batch.
    if (!isFinalBatch && shouldScheduleAmbientHydration(liveState.buildingRenderScope, next.length)) {
      liveState.quickViewAppendBuildingsCount += 1;
      liveState.quickViewAmbientBatchCount += 1;
      liveState.three?.appendBuildings(next);
    }
    applyComposedSceneData(map, null, null, {
      emitSummary: isFinalBatch || batchNumber % PROGRESSIVE_SUMMARY_EVERY_BATCHES === 0,
      updateMapSources: isFinalBatch,
      pushThreeMode: isFinalBatch ? "replace" : "skip",
    });
    index += PROGRESSIVE_BUILDING_BATCH_SIZE;
    if (index < remainingBuildings.length) {
      const nextDelay =
        typeof map.isMoving === "function" && map.isMoving()
          ? PROGRESSIVE_BUILDING_BATCH_DELAY_MS * 2
          : PROGRESSIVE_BUILDING_BATCH_DELAY_MS;
      liveState.progressiveHydrationTimer = setTimeout(
        step,
        nextDelay,
      );
    } else {
      liveState.progressiveHydrationTimer = null;
      liveState.progressiveLoading = false;
      emitSceneLoading(map);
      perfEnd("scheduleProgressiveLiveBuildings.total", t0, {
        batches: batchNumber,
      });
    }
    perfEnd("scheduleProgressiveLiveBuildings.batch", batchT0, {
      batchSize: next.length,
      batch: batchNumber,
      final: isFinalBatch ? 1 : 0,
    });
  };

  state.progressiveHydrationTimer = setTimeout(step, PROGRESSIVE_BUILDING_BATCH_DELAY_MS);
}

export async function focusAddress3DContext(
  map: MLMap,
  target: Address3DTarget,
): Promise<void> {
  const state = getSceneState(map);
  cancelProgressiveHydration(state);
  const bbox = makeClampedBbox(target.lon, target.lat, 0.012, 0.01);
  if (!bbox) return;

  beginMajorLoading(map, "Loading focused 3D context...");
  const requestSeq = ++state.focusRequestSeq;
  state.contextLoading = true;
  emitSceneLoading(map);
  try {
    const livePayload = await fetchLiveContext(bbox, 16);
    if (requestSeq !== state.focusRequestSeq) return;
    const liveBuildings = (livePayload?.buildings.features as BuildingFeature[]) ?? [];
    const liveFacilities =
      (livePayload?.facilities.features as FacilityFeature[]) ?? [];
    const nearest = nearestBuildingAtPoint(target.lon, target.lat, liveBuildings);
    const pinned = nearest ?? makePinnedBuildingFromPoint(target.lon, target.lat);
    const selection = selectSceneBuildings(
      liveBuildings,
      liveFacilities,
      [pinned],
      state.buildingRenderScope,
      { lon: target.lon, lat: target.lat },
    );

    state.lastLiveBuildings = selection.immediateBuildings;
    state.lastLiveFacilities = selection.facilities;
    state.lastLiveContextKey = bbox.map((value) => value.toFixed(4)).join(",");
    state.pinnedBuilding = pinned;
    state.contextRoads = livePayload?.roads ?? emptyFeatureCollection();
    state.contextWater = livePayload?.water ?? emptyFeatureCollection();
    state.contextGeneratedAt = livePayload?.generatedAt ?? new Date().toISOString();
    state.contextAttribution = livePayload?.attribution ?? "OpenStreetMap contributors";
    applyComposedSceneData(map, null, livePayload);
    await waitForPriorityRender(map);
    if (shouldScheduleAmbientHydration(state.buildingRenderScope, selection.deferredBuildings.length)) {
      scheduleProgressiveLiveBuildings(
        map,
        "focus",
        requestSeq,
        selection.deferredBuildings,
      );
    }
    emitSceneStatus(null);
  } catch {
    if (requestSeq !== state.focusRequestSeq) return;
    state.pinnedBuilding = makePinnedBuildingFromPoint(target.lon, target.lat);
    state.lastLiveBuildings = [];
    applyComposedSceneData(map, null, null);
    emitSceneStatus("Using fallback 3D marker for selected address.");
  } finally {
    if (requestSeq === state.focusRequestSeq) {
      state.contextLoading = false;
      emitSceneLoading(map);
    }
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
