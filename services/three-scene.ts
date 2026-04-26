import * as THREE from "three";
import maplibregl, {
  type CustomLayerInterface,
  type Map as MLMap,
} from "maplibre-gl";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import {
  FLOOD_LEVEL_STYLE,
  FLOOD_WIRE_LINEWIDTH,
  type FloodLevel,
} from "@/config/flood-colors";
import {
  DEFAULT_FLOOD_VISUALIZATION_SETTINGS,
  type FloodVisualizationSettings,
} from "@/config/flood-visualization";

/**
 * Three.js-powered MapLibre custom layer that renders 3D buildings,
 * facility beacons, and flood hazard patches for the AERIS 3D scene.
 *
 * Runs inside MapLibre's own WebGL context via `CustomLayerInterface`, so the
 * meshes stay perfectly aligned with the basemap and Terrain-RGB relief while
 * benefiting from real Three.js materials, lighting, and edge shading.
 *
 * Flood polygons are rendered as translucent water-like patches with subtle
 * `LineSegments2` contours. This keeps the basemap legible while making the
 * hazard read as contiguous floodwater instead of a mesh of outlines.
 */

export type BuildingFeature = GeoJSON.Feature<
  GeoJSON.Polygon,
  {
    kind?: string;
    height?: number;
    minHeight?: number;
    name?: string;
    /**
     * Highest MGB flood hazard level this building footprint intersects
     * (precomputed offline by ``scripts/annotate_flood_impact.py``). When
     * ``setFloodHighlight(true)`` is active these buildings are tinted with
     * the flood palette so you can see the affected structures at a glance.
     */
    floodLevel?: "low" | "medium" | "high";
  }
>;

export type FacilityFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    category?: string;
    categoryLabel?: string;
    name?: string;
    priority?: number;
  }
>;

export type FloodPolygonFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { level?: "low" | "medium" | "high" }
>;

export type ThreeSceneHandle = {
  layer: CustomLayerInterface;
  setBuildings(features: BuildingFeature[]): void;
  setFacilities(features: FacilityFeature[]): void;
  setBuildingsVisible(visible: boolean): void;
  setFacilitiesVisible(visible: boolean): void;
  /**
   * Set the minimum facility priority to render. Facilities with priority
   * below this threshold are skipped. Priority values:
   * 5 = hospital, 4 = evacuation, 3 = fire_station, 2 = police, 1 = other.
   * Pass 0 to render all facilities (default).
   */
  setFacilityPriorityFilter(minPriority: number): void;
  /**
   * Toggle flood-impact highlighting. When ``active`` is true, buildings
   * with a precomputed ``properties.floodLevel`` are rendered with the MGB
   * flood palette instead of their normal kind color.
   */
  setFloodHighlight(active: boolean): void;
  /**
   * Replace the flood hazard patch geometry. Each feature is rendered as a
   * translucent surface with a subtle contour color-coded by hazard level.
   * Passing an empty array clears the patches.
   */
  setFloodPolygons(features: FloodPolygonFeature[]): void;
  /** Show / hide the flood hazard patches without clearing their geometry. */
  setFloodPolygonsVisible(visible: boolean): void;
  /** Show / hide a single hazard level patch group. */
  setFloodLevelVisible(level: "low" | "medium" | "high", visible: boolean): void;
  /** Set the opacity of all flood patch and contour materials (0-1). */
  setFloodPolygonOpacity(opacity: number): void;
  /** Tune flood patch/wire visual style without changing the feature payload. */
  setFloodVisualizationSettings(settings: FloodVisualizationSettings): void;
  /**
   * Enable or disable per-frame animations (facility pin bobbing, flood pulse).
   * Disabling halts ``triggerRepaint`` loops so the map goes idle between
   * interactions, which eliminates continuous GPU/CPU load on static scenes.
   * Defaults to ``true``.
   */
  setAnimationsEnabled(enabled: boolean): void;
  dispose(): void;
};

// NOAH-inspired neutral greys with slight warm/cool bias per type so the
// city reads as a coherent massing while landmarks (hospital, government,
// etc.) still stand out subtly.
const BUILDING_PALETTE: Record<string, number> = {
  hospital: 0xdbe7f2,
  school: 0xe6e0cc,
  government: 0xe8d0cd,
  industrial: 0xc7cdd4,
  commercial: 0xd6d9de,
  residential: 0xe2e2e0,
  building: 0xdadde1,
};

// MGB flood impact palette — derived from the shared `FLOOD_LEVEL_STYLE`
// so the highlighted 3D buildings stay locked to the 2D flood palette.
const FLOOD_BUILDING_PALETTE: Record<FloodLevel, number> = {
  low: FLOOD_LEVEL_STYLE.low.hex,
  medium: FLOOD_LEVEL_STYLE.medium.hex,
  high: FLOOD_LEVEL_STYLE.high.hex,
};

const FACILITY_PALETTE: Record<string, number> = {
  hospital: 0x38bdf8,
  fire_station: 0xef4444,
  police: 0x60a5fa,
  school: 0xf59e0b,
  government: 0xf97316,
  evacuation: 0x34d399,
  other: 0xd1d5db,
};

// Fat-wireframe palette for flood hazard zone outlines. Uses the same
// `FLOOD_LEVEL_STYLE` hex values as the 2D scene so the legend stays coherent.
// `FLOOD_WIRE_LINEWIDTH` is imported: widths scale with severity so the
// most dangerous zones are the most visually prominent.
const FLOOD_WIRE_COLOR: Record<FloodLevel, number> = {
  low: FLOOD_LEVEL_STYLE.low.hex,
  medium: FLOOD_LEVEL_STYLE.medium.hex,
  high: FLOOD_LEVEL_STYLE.high.hex,
};

const FLOOD_PATCH_BASE_OPACITY: Record<FloodLevel, number> = {
  low: 0.26,
  medium: 0.32,
  high: 0.38,
};

const FLOOD_CONTOUR_OPACITY: Record<FloodLevel, number> = {
  low: 0.12,
  medium: 0.16,
  high: 0.2,
};

// Render-order strategy (decal model)
// -----------------------------------
// The flood surface used to be lifted in Z to clear the basemap, but the
// model origin is sea level while MapLibre's terrain-RGB raises the painted
// ground to its DEM elevation — a fixed Z offset can never reliably stay
// above terrain in hilly areas without sampling the DEM per-vertex. We
// instead render flood meshes as 2D decals with depth testing disabled,
// using deterministic `renderOrder` values to control draw order:
//
//   1. Terrain raster + hillshade (drawn by MapLibre before our custom layer)
//   2. Flood fill          (renderOrder = FLOOD_RENDER_ORDER_FILL)
//   3. Flood wireframe     (renderOrder = FLOOD_RENDER_ORDER_LINE)
//   4. Buildings/facilities (renderOrder = BUILDING_RENDER_ORDER) — write
//      depth so they always paint OVER flood, regardless of camera angle.
//
// This sidesteps z-fighting entirely and makes building occlusion stable
// under rotation (the previous transparent-sort heuristic flipped order
// per-frame as the camera moved).
const FLOOD_RENDER_ORDER_FILL = 10;
const FLOOD_RENDER_ORDER_LINE = 11;
const BUILDING_RENDER_ORDER = 20;

// Map-pin dimensions for critical facility markers.
// All values in model metres (1 unit = 1 metre after meterScale transform).
const PIN_FLOAT_HEIGHT = 20;     // metres pin head floats above building roof
const PIN_HEAD_RADIUS = 3.5;     // sphere head radius
const PIN_SPIKE_RADIUS = 0.8;    // spike base radius
// Spike length spans exactly from the sphere bottom to the building roof.
const PIN_SPIKE_LENGTH = PIN_FLOAT_HEIGHT - PIN_HEAD_RADIUS;
const FACILITY_DEFAULT_HEIGHT = 14; // fallback building height when no polygon matches
// Buildings render fully opaque (see `buildBuildings` / `buildFacilities`).
// Opacity constant intentionally removed — translucent buildings re-introduced
// transparent-sort flicker against the flood decal under camera rotation.
const BUILDING_WIREFRAME_OPACITY = 1.0;
const BUILDING_WIREFRAME_COLOR = 0x3b4454;

const DEFAULT_MAP_CENTER: [number, number] = [122, 12.5];

type MapRef = { current: MLMap | null };

/**
 * Extract all linear rings from a Polygon or MultiPolygon geometry.
 */
function getAllPolygonRings(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): GeoJSON.Position[][] {
  if (geom.type === "Polygon") return geom.coordinates;
  // MultiPolygon: flatten one level (array of polygons → array of rings)
  return geom.coordinates.flat(1);
}

/**
 * Fast axis-aligned bounding-box pre-filter before the more expensive
 * ray-casting point-in-polygon test.
 */
function bboxContains(
  ring: GeoJSON.Position[],
  lng: number,
  lat: number,
): boolean {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const c of ring) {
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  return lng >= minX && lng <= maxX && lat >= minY && lat <= maxY;
}

/**
 * Ray-casting even-odd rule point-in-polygon for a single ring.
 */
function pointInRing(
  ring: GeoJSON.Position[],
  lng: number,
  lat: number,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const crosses = (yi > lat) !== (yj > lat);
    const xIntersect = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses && lng < xIntersect) inside = !inside;
  }
  return inside;
}

/**
 * Return the building polygon that contains the facility point, or the
 * nearest building by centroid distance within ``maxDist`` degrees (~100 m).
 * Returns null if the pack has no matching polygon.
 */
function findBuildingPolygon(
  lng: number,
  lat: number,
  buildings: BuildingFeature[],
  maxDist = 0.001,
): BuildingFeature | null {
  // Pass 1 — exact containment
  for (const b of buildings) {
    const ring = b.geometry.coordinates[0];
    if (!ring || ring.length < 4) continue;
    if (bboxContains(ring, lng, lat) && pointInRing(ring, lng, lat)) return b;
  }
  // Pass 2 — nearest centroid fallback (catches cases where the facility
  // node sits just outside the building polygon due to OSM imprecision)
  let best: BuildingFeature | null = null;
  let bestDist = maxDist;
  for (const b of buildings) {
    const ring = b.geometry.coordinates[0];
    if (!ring || ring.length < 4) continue;
    let cx = 0, cy = 0;
    for (const c of ring) { cx += c[0]; cy += c[1]; }
    cx /= ring.length; cy /= ring.length;
    const d = Math.hypot(lng - cx, lat - cy);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

/**
 * Build a Three.js MapLibre custom layer. The returned handle exposes
 * setters for swapping feature payloads and toggling sub-group visibility
 * without re-adding the layer.
 */
// ---------------------------------------------------------------------------
// Dev-only performance instrumentation.
// All perf logging is stripped when process.env.NODE_ENV !== 'development'.
// ---------------------------------------------------------------------------
const DEV = process.env.NODE_ENV === "development";

function perfStart(label: string): number {
  if (!DEV) return 0;
  return performance.now();
}
function perfEnd(label: string, start: number, extra?: Record<string, number>) {
  if (!DEV || start === 0) return;
  const ms = (performance.now() - start).toFixed(1);
  const parts = [`[three-scene] ${label}: ${ms}ms`];
  if (extra) {
    for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
  }
  // eslint-disable-next-line no-console
  console.debug(parts.join("  "));
}

export function createThreeSceneLayer(mapRef: MapRef): ThreeSceneHandle {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.Camera | null = null;
  let buildingGroup = new THREE.Group();
  let facilityGroup = new THREE.Group();
  let floodGroup = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const floodDisposables: Array<{ dispose: () => void }> = [];
  const floodMaterials: Array<LineMaterial | THREE.MeshBasicMaterial> = [];
  const floodFillMaterials: Array<{
    material: THREE.MeshBasicMaterial;
    level: FloodLevel;
  }> = [];
  const floodLineMaterials: Array<{
    material: LineMaterial;
    level: FloodLevel;
  }> = [];
  // NOTE: a feather (soft-edge) mesh used to live alongside the fill, generated
  // per-polygon via Turf `buffer()`. It was removed because the decal-style
  // fill no longer needs an outer fade ring to look continuous — the feather
  // doubled flood draw calls and caused a CPU spike on slider drags. When the
  // future "flood expansion" feature lands, an animated soft edge should be
  // implemented as a shader effect on the existing fill mesh (radial alpha
  // gradient driven by a uniform), not as a separate Turf-buffered geometry.
  const floodLineMeshes: LineSegments2[] = [];
  const floodLevelMeshes: Partial<Record<FloodLevel, THREE.Group>> = {};
  const facilityPointers: Array<{ pointer: THREE.Group; baseZ: number }> = [];

  let origin: maplibregl.MercatorCoordinate | null = null;
  let meterScale = 1;
  // Hoisted per-frame allocations for the `render()` hot-path. MapLibre
  // calls `render()` on every animation frame, so allocating two Matrix4s
  // + one Vector3 each tick churns the GC and causes visible jank during
  // pan/zoom on mid-tier devices. Reuse the same instances instead.
  const projectionMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4();
  const meterScaleVec = new THREE.Vector3();
  let buildingsVisible = true;
  let facilitiesVisible = true;
  let floodHighlightActive = false;
  let floodPolygonsVisible = true;
  let facilityPriorityFilter = 0; // 0 = all, 1+ = filter by minimum priority
  let floodVisualizationSettings = { ...DEFAULT_FLOOD_VISUALIZATION_SETTINGS };
  const floodVisibleLevels: Record<"low" | "medium" | "high", boolean> = {
    low: true,
    medium: true,
    high: true,
  };
  let floodPolygonOpacity = 1.0;
  let pendingBuildings: BuildingFeature[] = [];
  let pendingFacilities: FacilityFeature[] = [];
  let pendingFloodFeatures: FloodPolygonFeature[] = [];

  // --- Animation control -------------------------------------------------
  // Facility pins bob and flood patches pulse every frame while animations
  // are active. Both share a single `animationsEnabled` flag so the caller
  // can opt-out on low-power devices without losing the visual concept.
  // When false, `render()` omits all per-frame mutation and no
  // `triggerRepaint()` is posted, allowing MapLibre to go idle.
  let animationsEnabled = true;

  function computeOrigin(): maplibregl.MercatorCoordinate {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    let count = 0;

    const accept = (lng: number, lat: number) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      count += 1;
    };

    for (const f of pendingBuildings) {
      for (const ring of f.geometry.coordinates) {
        for (const c of ring) accept(c[0], c[1]);
      }
    }
    for (const f of pendingFacilities) {
      accept(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    }
    // Include flood polygon coordinates so the wireframe rings project into
    // the same model space even when buildings haven't loaded yet.
    for (const f of pendingFloodFeatures) {
      for (const ring of getAllPolygonRings(f.geometry)) {
        for (const c of ring) accept(c[0], c[1]);
      }
    }

    if (count === 0) {
      return maplibregl.MercatorCoordinate.fromLngLat(DEFAULT_MAP_CENTER, 0);
    }
    return maplibregl.MercatorCoordinate.fromLngLat(
      [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      0,
    );
  }

  function toModelXY(lng: number, lat: number): [number, number] {
    if (!origin) return [0, 0];
    const m = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    const dx = (m.x - origin.x) / meterScale;
    // MapLibre mercator Y grows southward, our model Y = north-meters.
    const dy = -(m.y - origin.y) / meterScale;
    return [dx, dy];
  }

  function clearGroups() {
    if (!scene) return;
    scene.remove(buildingGroup);
    scene.remove(facilityGroup);
    scene.remove(floodGroup);
    facilityPointers.length = 0;
    for (const d of disposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    }
    buildingGroup = new THREE.Group();
    facilityGroup = new THREE.Group();
    buildingGroup.visible = buildingsVisible;
    facilityGroup.visible = facilitiesVisible;
  }

  function clearFloodGroup() {
    if (!scene) return;
    scene.remove(floodGroup);
    for (const d of floodDisposables.splice(0)) {
      try {
        d.dispose();
      } catch {
        /* noop */
      }
    }
    floodMaterials.length = 0;
    floodFillMaterials.length = 0;
    floodLineMaterials.length = 0;
    floodLineMeshes.length = 0;
    delete floodLevelMeshes.low;
    delete floodLevelMeshes.medium;
    delete floodLevelMeshes.high;
    floodGroup = new THREE.Group();
    floodGroup.visible = floodPolygonsVisible;
  }

  function buildBuildings() {
    // Draw-call batching: every building used to produce its own
    // `ExtrudeGeometry` + `MeshStandardMaterial` + `EdgesGeometry` +
    // `LineBasicMaterial`, which for N-thousand OSM packs meant O(N)
    // draw calls per frame. We now group buildings by their flood-tint
    // bucket (the four visual classes — normal, flood-low, flood-medium,
    // flood-high) and merge each bucket's extrusions into a single
    // `BufferGeometry` with vertex colors baked in for per-building
    // tone jitter. Result: O(flood_buckets) draw calls for the whole city,
    // regardless of how many buildings the pack contains.
    type BucketKey = "normal" | FloodLevel;
    type Bucket = {
      geoms: THREE.BufferGeometry[];
      edgeGeoms: THREE.BufferGeometry[];
      isFlooded: boolean;
      level?: FloodLevel;
    };
    const buckets: Map<BucketKey, Bucket> = new Map();

    for (const feat of pendingBuildings) {
      const props = feat.properties ?? {};
      const kind = typeof props.kind === "string" ? props.kind : "building";
      const height = Math.max(
        4,
        typeof props.height === "number" ? props.height : 10,
      );
      const minHeight = Math.max(
        0,
        typeof props.minHeight === "number" ? props.minHeight : 0,
      );
      const depth = Math.max(2, height - minHeight);
      const ring = feat.geometry.coordinates[0];
      if (!ring || ring.length < 4) continue;

      const shape = new THREE.Shape();
      const [x0, y0] = toModelXY(ring[0][0], ring[0][1]);
      shape.moveTo(x0, y0);
      for (let i = 1; i < ring.length - 1; i++) {
        const [x, y] = toModelXY(ring[i][0], ring[i][1]);
        shape.lineTo(x, y);
      }
      shape.closePath();

      const geom = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: false,
        curveSegments: 1,
      });
      if (minHeight > 0) geom.translate(0, 0, minHeight);

      const floodLevel = props.floodLevel as FloodLevel | undefined;
      const isFlooded =
        floodHighlightActive &&
        floodLevel !== undefined &&
        floodVisibleLevels[floodLevel];
      const baseColor = isFlooded
        ? FLOOD_BUILDING_PALETTE[floodLevel!]
        : (BUILDING_PALETTE[kind] ?? BUILDING_PALETTE.building);
      // Deterministic tone jitter keyed off the first coordinate so the
      // same building always looks the same. Skip jitter on flood-tinted
      // buildings so they read as a single clear colour signal.
      const seed = Math.abs(Math.sin(ring[0][0] * 127.1 + ring[0][1] * 311.7));
      const jitter = isFlooded ? 1 : 0.9 + ((seed * 1000) % 1) * 0.2;
      const threeColor = new THREE.Color(baseColor).multiplyScalar(jitter);

      // Bake the per-building colour into a `color` vertex attribute so
      // the shared material can render all buildings in the bucket with
      // their individual tones.
      const vertexCount = geom.attributes.position.count;
      const colors = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        colors[i * 3] = threeColor.r;
        colors[i * 3 + 1] = threeColor.g;
        colors[i * 3 + 2] = threeColor.b;
      }
      geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const edges = new THREE.EdgesGeometry(geom, 25);

      const key: BucketKey = isFlooded ? (floodLevel as FloodLevel) : "normal";
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          geoms: [],
          edgeGeoms: [],
          isFlooded,
          level: isFlooded ? floodLevel : undefined,
        };
        buckets.set(key, bucket);
      }
      bucket.geoms.push(geom);
      bucket.edgeGeoms.push(edges);
    }

    // Materials are shared within each bucket (normal vs. flood level), collapsing
    // thousands of material records to one per visual class per bucket type.

    for (const bucket of buckets.values()) {
      if (bucket.geoms.length === 0) continue;
      const merged = BufferGeometryUtils.mergeGeometries(bucket.geoms, false);
      // The per-building geometries are retained on disposables via the
      // merged output; the originals can be released now that their
      // buffers have been copied into the merged attribute arrays.
      for (const g of bucket.geoms) g.dispose();

      const emissiveColor = bucket.isFlooded
        ? FLOOD_BUILDING_PALETTE[bucket.level!]
        : 0x000000;
      // Fill material strategy:
      //   - Unaffected (normal): 40% translucent, dark grey wireframe. Reduce clutter.
      //   - Flooded: 65% translucent, flood-level-colored outline. Stand out as affected.
      // Both use hazard palette for vertex colors; flooded adds emissive tint.
      const sharedMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        emissive: emissiveColor,
        emissiveIntensity: bucket.isFlooded ? 0.25 : 0,
        metalness: 0.05,
        roughness: bucket.isFlooded ? 0.6 : 0.85,
        flatShading: false,
        ...(bucket.isFlooded
          ? { transparent: true, opacity: 0.65 } // affected buildings
          : { transparent: true, opacity: 0.4 } // unaffected buildings
        ),
      });
      const mesh = new THREE.Mesh(merged, sharedMat);
      mesh.renderOrder = BUILDING_RENDER_ORDER;
      buildingGroup.add(mesh);

      // Edge material: flood level color for affected, dark grey for unaffected.
      const edgeColor = bucket.isFlooded
        ? FLOOD_BUILDING_PALETTE[bucket.level!]
        : BUILDING_WIREFRAME_COLOR;
      const edgeMat = new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: BUILDING_WIREFRAME_OPACITY,
      });

      const mergedEdges = BufferGeometryUtils.mergeGeometries(
        bucket.edgeGeoms,
        false,
      );
      for (const g of bucket.edgeGeoms) g.dispose();
      const edgeMesh = new THREE.LineSegments(mergedEdges, edgeMat);
      edgeMesh.renderOrder = BUILDING_RENDER_ORDER;
      buildingGroup.add(edgeMesh);

      disposables.push(merged, sharedMat, mergedEdges, edgeMat);
    }
  }

  function buildFacilities() {
    for (const feat of pendingFacilities) {
      const props = feat.properties ?? {};
      const priority = typeof props.priority === "number" ? props.priority : 0;
      if (priority < facilityPriorityFilter) continue;

      const cat = typeof props.category === "string" ? props.category : "other";
      const color = FACILITY_PALETTE[cat] ?? FACILITY_PALETTE.other;
      const threeColor = new THREE.Color(color);
      const facilityLng = feat.geometry.coordinates[0];
      const facilityLat = feat.geometry.coordinates[1];
      const [cx, cy] = toModelXY(facilityLng, facilityLat);

      // ── 3D Building ──────────────────────────────────────────────────────
      // Try to find the actual property polygon from the buildings pack so
      // the facility renders with its true footprint outline, not a generic box.
      const matchedBuilding = findBuildingPolygon(
        facilityLng, facilityLat, pendingBuildings,
      );

      let buildingHeight: number;

      if (matchedBuilding) {
        const bProps = matchedBuilding.properties ?? {};
        buildingHeight = Math.max(
          6,
          typeof bProps.height === "number" ? bProps.height : FACILITY_DEFAULT_HEIGHT,
        );
        const minH = Math.max(
          0,
          typeof bProps.minHeight === "number" ? bProps.minHeight : 0,
        );
        const depth = Math.max(4, buildingHeight - minH);
        const ring = matchedBuilding.geometry.coordinates[0];

        // Build the extruded footprint — identical pipeline to buildBuildings()
        // but tinted with the facility category colour.
        const shape = new THREE.Shape();
        const [x0, y0] = toModelXY(ring[0][0], ring[0][1]);
        shape.moveTo(x0, y0);
        for (let i = 1; i < ring.length - 1; i++) {
          const [x, y] = toModelXY(ring[i][0], ring[i][1]);
          shape.lineTo(x, y);
        }
        shape.closePath();

        const geom = new THREE.ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: false,
          curveSegments: 1,
        });
        if (minH > 0) geom.translate(0, 0, minH);

        // Bake a uniform facility colour into vertex attributes so the
        // shared vertexColors material pipeline renders it correctly.
        const vertCount = geom.attributes.position.count;
        const colors = new Float32Array(vertCount * 3);
        for (let i = 0; i < vertCount; i++) {
          colors[i * 3]     = threeColor.r;
          colors[i * 3 + 1] = threeColor.g;
          colors[i * 3 + 2] = threeColor.b;
        }
        geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          emissive: color,
          emissiveIntensity: 0.25,
          roughness: 0.65,
          metalness: 0.1,
          transparent: true,
          opacity: 0.75,
          // polygonOffset keeps facility footprint (coplanar with matching OSM
          // building) from Z-fighting the regular building mesh underneath.
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.renderOrder = BUILDING_RENDER_ORDER;
        facilityGroup.add(mesh);

        const edgesGeom = new THREE.EdgesGeometry(geom, 25);
        const edgeMat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: BUILDING_WIREFRAME_OPACITY,
        });
        const edgeMesh = new THREE.LineSegments(edgesGeom, edgeMat);
        edgeMesh.renderOrder = BUILDING_RENDER_ORDER;
        facilityGroup.add(edgeMesh);

        disposables.push(geom, mat, edgesGeom, edgeMat);
      } else {
        // Fallback: simple box centred on the facility point when OSM has no
        // polygon for this location (e.g. point-only amenity tags).
        buildingHeight = FACILITY_DEFAULT_HEIGHT;
        const boxGeom = new THREE.BoxGeometry(8, 8, buildingHeight);
        const boxMat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.25,
          roughness: 0.65,
          metalness: 0.1,
          transparent: true,
          opacity: 0.75,
        });
        const boxMesh = new THREE.Mesh(boxGeom, boxMat);
        // BoxGeometry is centred at origin; shift so its base sits on z = 0.
        boxMesh.position.set(cx, cy, buildingHeight / 2);
        boxMesh.renderOrder = BUILDING_RENDER_ORDER;
        facilityGroup.add(boxMesh);

        const boxEdgesGeom = new THREE.EdgesGeometry(boxGeom, 25);
        const boxEdgeMat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: BUILDING_WIREFRAME_OPACITY,
        });
        const boxEdgeMesh = new THREE.LineSegments(boxEdgesGeom, boxEdgeMat);
        boxEdgeMesh.position.copy(boxMesh.position);
        boxEdgeMesh.renderOrder = BUILDING_RENDER_ORDER;
        facilityGroup.add(boxEdgeMesh);
        disposables.push(boxGeom, boxMat, boxEdgesGeom, boxEdgeMat);
      }

      // ── Animated map-pin pointer ─────────────────────────────────────────
      // The pin group is positioned PIN_FLOAT_HEIGHT metres above the building
      // roof and animated (bobbing) each frame. All child meshes are in the
      // group's local space, so only the group's z needs to change per frame.
      //
      // Geometry (all in group-local z, group origin = building roof + float):
      //   z = 0              → sphere head (map-pin ball)
      //   z = -(float+head)/2 → spike centre
      //   z = -float          → spike tip  (points at roof below)
      //
      // ConeGeometry default axis: +Y. After rotation.x = -π/2 the tip
      // moves to -Z (downward in world space), which is what we need.

      const baseZ = buildingHeight + PIN_FLOAT_HEIGHT;
      const pointerGroup = new THREE.Group();
      pointerGroup.position.set(cx, cy, baseZ);

      // Sphere head
      const headGeom = new THREE.SphereGeometry(PIN_HEAD_RADIUS, 16, 12);
      const headMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        metalness: 0.15,
      });
      const headMesh = new THREE.Mesh(headGeom, headMat);
      // head sits exactly at the group origin (z = 0)
      pointerGroup.add(headMesh);

      // Downward spike — tip points toward the building below.
      // rotation.x = -π/2  →  ConeGeometry +Y tip becomes -Z (downward).
      const spikeGeom = new THREE.ConeGeometry(PIN_SPIKE_RADIUS, PIN_SPIKE_LENGTH, 8);
      const spikeMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.55,
        roughness: 0.4,
        metalness: 0.1,
      });
      const spikeMesh = new THREE.Mesh(spikeGeom, spikeMat);
      spikeMesh.rotation.x = -Math.PI / 2;
      // Centre the spike so its base (~sphere bottom) is just below the head
      // and its tip reaches the building roof level.
      spikeMesh.position.z = -(PIN_HEAD_RADIUS + PIN_SPIKE_LENGTH) / 2;
      pointerGroup.add(spikeMesh);

      facilityGroup.add(pointerGroup);
      facilityPointers.push({ pointer: pointerGroup, baseZ });
      disposables.push(headGeom, headMat, spikeGeom, spikeMat);
    }
  }

  /**
   * Given all polygon rings for a single hazard level, return a flat
   * ``LineSegmentsGeometry`` position array containing only the exterior
   * boundary segments — edges shared by exactly two rings (internal cell
   * borders) are discarded, leaving only the clean outer contour.
   *
   * Keys are built from the original geo coordinates (exact floating-point
   * match) so no precision rounding is needed.
   */
  function buildExteriorSegments(
    rings: GeoJSON.Position[][],
    toXY: (lng: number, lat: number) => [number, number],
    z: number,
  ): number[] {
    const t0 = perfStart("buildExteriorSegments");
    // Map from canonical edge key → { model-space endpoints, occurrence count }
    type EdgeEntry = { x0: number; y0: number; x1: number; y1: number; count: number };
    const edgeMap = new Map<string, EdgeEntry>();

    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0; i < n - 1; i++) {
        const lng0 = ring[i][0],   lat0 = ring[i][1];
        const lng1 = ring[i+1][0], lat1 = ring[i+1][1];

        // Canonical ordering: smaller coordinate pair first so A→B and B→A
        // map to the same key (shared edges always traverse in opposite dirs).
        const fwd = lng0 < lng1 || (lng0 === lng1 && lat0 <= lat1);
        const key = fwd
          ? `${lng0},${lat0}|${lng1},${lat1}`
          : `${lng1},${lat1}|${lng0},${lat0}`;

        const existing = edgeMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          const [x0, y0] = toXY(lng0, lat0);
          const [x1, y1] = toXY(lng1, lat1);
          edgeMap.set(key, { x0, y0, x1, y1, count: 1 });
        }
      }
    }

    // Keep only edges that appear once — those are on the exterior boundary.
    const positions: number[] = [];
    for (const e of edgeMap.values()) {
      if (e.count === 1) {
        positions.push(e.x0, e.y0, z, e.x1, e.y1, z);
      }
    }
    perfEnd("buildExteriorSegments", t0, {
      rings: rings.length,
      edges: edgeMap.size,
      exterior: positions.length / 6,
    });
    return positions;
  }

  function buildPatchGeometry(
    features: FloodPolygonFeature[],
    toXY: (lng: number, lat: number) => [number, number],
    z: number,
  ): THREE.BufferGeometry | null {
    const geometries: THREE.BufferGeometry[] = [];

    const addPolygon = (rings: GeoJSON.Position[][]) => {
      const outerRing = rings[0];
      if (!outerRing || outerRing.length < 4) return;

      const shape = new THREE.Shape();
      const [x0, y0] = toXY(outerRing[0][0], outerRing[0][1]);
      shape.moveTo(x0, y0);
      for (let i = 1; i < outerRing.length - 1; i++) {
        const [x, y] = toXY(outerRing[i][0], outerRing[i][1]);
        shape.lineTo(x, y);
      }
      shape.closePath();

      for (const holeRing of rings.slice(1)) {
        if (holeRing.length < 4) continue;
        const hole = new THREE.Path();
        const [hx0, hy0] = toXY(holeRing[0][0], holeRing[0][1]);
        hole.moveTo(hx0, hy0);
        for (let i = 1; i < holeRing.length - 1; i++) {
          const [x, y] = toXY(holeRing[i][0], holeRing[i][1]);
          hole.lineTo(x, y);
        }
        hole.closePath();
        shape.holes.push(hole);
      }

      const geom = new THREE.ShapeGeometry(shape);
      geom.translate(0, 0, z);
      geometries.push(geom);
    };

    for (const feature of features) {
      const geom = feature.geometry;
      if (geom.type === "Polygon") {
        addPolygon(geom.coordinates);
      } else {
        for (const polygon of geom.coordinates) addPolygon(polygon);
      }
    }

    if (geometries.length === 0) return null;
    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const geom of geometries) geom.dispose();
    return merged ?? null;
  }

  function applyFloodOpacity(
    timeSeconds = performance.now() * 0.001,
    animated = false,
  ) {
    const wave = animated ? 0.5 + Math.sin(timeSeconds * 0.75) * 0.5 : 0.5;
    const fillPulse = 0.92 + wave * 0.16;
    const linePulse = 0.96 + wave * 0.08;

    for (const { material, level } of floodFillMaterials) {
      material.color.set(floodVisualizationSettings.waterColor);
      material.opacity =
        FLOOD_PATCH_BASE_OPACITY[level] *
        floodPolygonOpacity *
        floodVisualizationSettings.waterOpacity *
        fillPulse;
    }
    for (const { material, level } of floodLineMaterials) {
      material.color.set(floodVisualizationSettings.wireframeColors[level]);
      material.opacity =
        FLOOD_CONTOUR_OPACITY[level] *
        floodPolygonOpacity *
        floodVisualizationSettings.wireframeBrightness *
        linePulse;
      material.linewidth =
        FLOOD_WIRE_LINEWIDTH[level] *
        floodVisualizationSettings.wireframeThickness;
    }
  }

  function sampleExteriorSegments(positions: number[], percent: number): number[] {
    if (percent >= 99.5 || positions.length < 12) return positions;
    if (percent <= 0) return [];
    const segmentCount = positions.length / 6;
    const keepCount = Math.max(1, Math.round(segmentCount * (percent / 100)));
    const stride = segmentCount / keepCount;
    // Use a pre-sized Float64 buffer (6 values per segment) to avoid repeated
    // Array.push + spread overhead for high-density flood contour packs.
    const sampled = new Float64Array(keepCount * 6);
    for (let i = 0; i < keepCount; i++) {
      const segmentIndex = Math.min(segmentCount - 1, Math.floor(i * stride));
      const src = segmentIndex * 6;
      const dst = i * 6;
      sampled[dst]     = positions[src];
      sampled[dst + 1] = positions[src + 1];
      sampled[dst + 2] = positions[src + 2];
      sampled[dst + 3] = positions[src + 3];
      sampled[dst + 4] = positions[src + 4];
      sampled[dst + 5] = positions[src + 5];
    }
    // LineSegmentsGeometry.setPositions accepts number[] or Float32Array;
    // convert to a plain array so callers remain type-compatible.
    return Array.from(sampled);
  }

  function needsFloodGeometryRebuild(
    prev: FloodVisualizationSettings,
    next: FloodVisualizationSettings,
  ) {
    // Only the wireframe-segment subsample count actually changes geometry.
    // `wireframeEnabled` and all other style fields are visibility/material
    // tweaks. (`edgeFadeDistance` used to drive the feather rebuild but the
    // feather mesh has been removed; the field is preserved in the settings
    // type for forward compatibility with the planned flood-expansion FX.)
    return prev.wireframePolygonCount !== next.wireframePolygonCount;
  }

  function shouldAnimateFlood() {
    if (!animationsEnabled) return false;
    if (!floodPolygonsVisible || !floodGroup.visible) return false;
    if (
      floodFillMaterials.length === 0 &&
      floodLineMaterials.length === 0
    ) {
      return false;
    }
    return (["low", "medium", "high"] as const).some(
      (level) => floodVisibleLevels[level],
    );
  }

  function rebuildFlood() {
    if (!scene) return;
    const t0 = perfStart("rebuildFlood");
    clearFloodGroup();

    if (pendingFloodFeatures.length === 0) {
      scene.add(floodGroup);
      mapRef.current?.triggerRepaint();
      perfEnd("rebuildFlood", t0, { features: 0 });
      return;
    }

    // If buildings haven't set an origin yet, derive one from the flood
    // polygon bounds so the wireframe is immediately renderable.
    if (!origin) {
      origin = computeOrigin();
      meterScale = origin.meterInMercatorCoordinateUnits();
    }

    // Decal-style flood rendering: meshes are built at z=0 in model space and
    // disable depth testing so the basemap raster (which MapLibre paints onto
    // the terrain DEM at variable elevations) can never bleed through. Draw
    // order is governed by `renderOrder` instead — see the FLOOD_RENDER_ORDER_*
    // constants at the top of this file.

    // Collect features and rings per level. Rings feed the exterior contour
    // dedupe, while features preserve polygon/hole structure for filled patches.
    const levelRings: Record<"low" | "medium" | "high", GeoJSON.Position[][]> =
      { low: [], medium: [], high: [] };
    const levelFeatures: Record<FloodLevel, FloodPolygonFeature[]> = {
      low: [],
      medium: [],
      high: [],
    };

    for (const feat of pendingFloodFeatures) {
      const lvl = (feat.properties?.level ?? "low") as
        | "low"
        | "medium"
        | "high";
      levelFeatures[lvl].push(feat);
      for (const ring of getAllPolygonRings(feat.geometry)) {
        if (ring.length >= 2) levelRings[lvl].push(ring);
      }
    }

    for (const lvl of ["low", "medium", "high"] as const) {
      const levelGroup = new THREE.Group();
      levelGroup.visible = floodVisibleLevels[lvl];

      const patchGeom = buildPatchGeometry(levelFeatures[lvl], toModelXY, 0);
      if (patchGeom) {
        const fillOpacity = FLOOD_PATCH_BASE_OPACITY[lvl] * floodPolygonOpacity;
        const fillMat = new THREE.MeshBasicMaterial({
          color: floodVisualizationSettings.waterColor,
          transparent: true,
          opacity: fillOpacity,
          // Decal: ignore depth so terrain elevation can't occlude us.
          // Buildings still occlude flood because they have a higher
          // `renderOrder` and write to depth (see BUILDING_RENDER_ORDER).
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.NormalBlending,
        });
        const patchMesh = new THREE.Mesh(patchGeom, fillMat);
        patchMesh.renderOrder = FLOOD_RENDER_ORDER_FILL;
        levelGroup.add(patchMesh);
        floodMaterials.push(fillMat);
        floodFillMaterials.push({
          material: fillMat,
          level: lvl,
        });
        floodDisposables.push(patchGeom, fillMat);
      }

      const pos = buildExteriorSegments(levelRings[lvl], toModelXY, 0);
      if (pos.length >= 6) {
        const sampledPos = sampleExteriorSegments(
          pos,
          floodVisualizationSettings.wireframePolygonCount,
        );

        if (floodVisualizationSettings.wireframeEnabled && sampledPos.length >= 6) {
          const geom = new LineSegmentsGeometry();
          geom.setPositions(sampledPos);
          const lineOpacity = FLOOD_CONTOUR_OPACITY[lvl] * floodPolygonOpacity;
          const mat = new LineMaterial({
            color: floodVisualizationSettings.wireframeColors[lvl],
            linewidth:
              FLOOD_WIRE_LINEWIDTH[lvl] *
              floodVisualizationSettings.wireframeThickness,
            transparent: true,
            opacity: lineOpacity,
            // Decal: same rationale as the fill — depth testing off so the
            // contour line is never clipped by terrain. Renders just above
            // the fill via FLOOD_RENDER_ORDER_LINE.
            depthTest: false,
            depthWrite: false,
          });
          // Use AdditiveBlending for a soft glow instead of hard outline
          (mat as any).blending = THREE.AdditiveBlending;

          const mesh = new LineSegments2(geom, mat);
          mesh.renderOrder = FLOOD_RENDER_ORDER_LINE;
          levelGroup.add(mesh);
          floodMaterials.push(mat);
          floodLineMeshes.push(mesh);
          floodLineMaterials.push({
            material: mat,
            level: lvl,
          });
          floodDisposables.push(geom, mat);
        }
      }

      if (levelGroup.children.length === 0) continue;
      floodGroup.add(levelGroup);
      floodLevelMeshes[lvl] = levelGroup;
    }

    applyFloodOpacity();
    scene.add(floodGroup);
    mapRef.current?.triggerRepaint();
    perfEnd("rebuildFlood", t0, { features: pendingFloodFeatures.length });
  }

  function rebuild() {
    if (!scene) return;
    const t0 = perfStart("rebuild");
    clearGroups();
    if (pendingBuildings.length === 0 && pendingFacilities.length === 0) {
      origin = null;
      scene.add(buildingGroup);
      scene.add(facilityGroup);
      rebuildFlood();
      perfEnd("rebuild", t0, { buildings: 0, facilities: 0 });
      return;
    }

    origin = computeOrigin();
    meterScale = origin.meterInMercatorCoordinateUnits();

    buildBuildings();
    buildFacilities();

    scene.add(buildingGroup);
    scene.add(facilityGroup);
    // Rebuild flood wireframe with the freshly computed origin so all
    // geo-coordinates project into the same model space.
    rebuildFlood();
    mapRef.current?.triggerRepaint();
    perfEnd("rebuild", t0, {
      buildings: pendingBuildings.length,
      facilities: pendingFacilities.length,
    });
  }

  // `rebuild()` (and `rebuildFlood()`) are expensive: for large packs they
  // re-extrude every building and rebuild line-segment geometries on the
  // main thread. When toggling flood levels or pushing new OSM payloads
  // mid-interaction this manifests as visible pan/zoom jank. Wrap both in
  // an idle-time scheduler that collapses N calls-per-tick down to one
  // and runs off the critical rendering path.
  const getIdleScheduler = (): {
    schedule: (cb: () => void) => number;
    cancel: (id: number) => void;
  } => {
    if (
      typeof window !== "undefined" &&
      typeof (window as unknown as { requestIdleCallback?: unknown })
        .requestIdleCallback === "function"
    ) {
      const w = window as unknown as {
        requestIdleCallback: (
          cb: () => void,
          opts?: { timeout: number },
        ) => number;
        cancelIdleCallback: (id: number) => void;
      };
      return {
        schedule: (cb) => w.requestIdleCallback(cb, { timeout: 150 }),
        cancel: (id) => w.cancelIdleCallback(id),
      };
    }
    return {
      schedule: (cb) => setTimeout(cb, 0) as unknown as number,
      cancel: (id) => clearTimeout(id as unknown as NodeJS.Timeout),
    };
  };
  const idle = getIdleScheduler();
  let rebuildHandle: number | null = null;
  let floodRebuildHandle: number | null = null;

  function scheduleRebuild() {
    if (!scene) return;
    if (rebuildHandle !== null) return;
    rebuildHandle = idle.schedule(() => {
      rebuildHandle = null;
      // A flood-only rebuild may have been queued behind us — if it fires
      // first it'll no-op against the same scene, but cancelling it here
      // avoids a redundant pass immediately after a full rebuild.
      if (floodRebuildHandle !== null) {
        idle.cancel(floodRebuildHandle);
        floodRebuildHandle = null;
      }
      rebuild();
    });
  }

  function scheduleRebuildFlood() {
    if (!scene) return;
    if (floodRebuildHandle !== null) return;
    // If a full rebuild is already pending it will cover the flood pass.
    if (rebuildHandle !== null) return;
    floodRebuildHandle = idle.schedule(() => {
      floodRebuildHandle = null;
      rebuildFlood();
    });
  }

  const layer: CustomLayerInterface = {
    id: "lyr-three-scene",
    type: "custom",
    renderingMode: "3d",
    onAdd(map, gl) {
      scene = new THREE.Scene();
      camera = new THREE.Camera();

      const ambient = new THREE.AmbientLight(0xf5f7fb, 0.8);
      const sun = new THREE.DirectionalLight(0xffffff, 0.95);
      sun.position.set(0.55, 0.45, 0.9).normalize();
      const rim = new THREE.DirectionalLight(0x9fb6cf, 0.25);
      rim.position.set(-0.6, -0.2, 0.3).normalize();
      scene.add(ambient);
      scene.add(sun);
      scene.add(rim);

      scene.add(buildingGroup);
      scene.add(facilityGroup);
      // floodGroup is added (and re-added) inside rebuildFlood()

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl as WebGL2RenderingContext,
        antialias: true,
      });
      renderer.autoClear = false;

      rebuild();
    },
    render(_gl, matrix) {
      if (!renderer || !scene || !camera || !origin) return;

      const t0 = perfStart("render");
      const time = performance.now() * 0.001;

      // Animate facility pins only when animations are globally enabled.
      // Each pointer stores its `baseZ` (building roof + PIN_FLOAT_HEIGHT) so
      // variable-height buildings all animate relative to their own roofline.
      if (animationsEnabled && facilityPointers.length > 0) {
        for (const { pointer, baseZ } of facilityPointers) {
          pointer.position.z = baseZ + Math.sin(time * 2.0) * 1.8;
        }
      }

      const animateFlood = shouldAnimateFlood();
      if (animateFlood) applyFloodOpacity(time, true);

      projectionMatrix.fromArray(matrix);
      meterScaleVec.set(meterScale, -meterScale, meterScale);
      localMatrix
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(meterScaleVec);
      // `multiplyMatrices` writes into the first matrix's buffer in-place
      // (as opposed to `multiply`, which would also work but reads better
      // when we're explicit that we're reusing `projectionMatrix`).
      camera.projectionMatrix = projectionMatrix.multiply(localMatrix);
      renderer.resetState();
      renderer.render(scene, camera);

      // Only force the next frame when something actually animated — avoids
      // a continuous 60 fps repaint loop for purely static flood/building scenes.
      if (animateFlood || (animationsEnabled && facilityPointers.length > 0)) {
        mapRef.current?.triggerRepaint();
      }

      perfEnd("render", t0);
    },
    onRemove() {
      if (rebuildHandle !== null) {
        idle.cancel(rebuildHandle);
        rebuildHandle = null;
      }
      if (floodRebuildHandle !== null) {
        idle.cancel(floodRebuildHandle);
        floodRebuildHandle = null;
      }
      for (const d of disposables.splice(0)) {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      }
      for (const d of floodDisposables.splice(0)) {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      }
      floodMaterials.length = 0;
      floodFillMaterials.length = 0;
      floodLineMaterials.length = 0;
      floodLineMeshes.length = 0;
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
    },
  };

  return {
    layer,
    setBuildings(features) {
      pendingBuildings = features ?? [];
      if (scene) scheduleRebuild();
    },
    setFacilities(features) {
      pendingFacilities = features ?? [];
      if (scene) scheduleRebuild();
    },
    setBuildingsVisible(v) {
      buildingsVisible = v;
      buildingGroup.visible = v;
      mapRef.current?.triggerRepaint();
    },
    setFacilitiesVisible(v) {
      facilitiesVisible = v;
      facilityGroup.visible = v;
      mapRef.current?.triggerRepaint();
    },
    setFacilityPriorityFilter(minPriority) {
      if (facilityPriorityFilter === minPriority) return;
      facilityPriorityFilter = minPriority;
      if (scene) scheduleRebuild();
    },
    setFloodHighlight(active) {
      if (floodHighlightActive === active) return;
      floodHighlightActive = active;
      if (scene) scheduleRebuild();
    },
    setFloodPolygons(features) {
      pendingFloodFeatures = features ?? [];
      if (scene) scheduleRebuildFlood();
    },
    setFloodPolygonsVisible(visible) {
      floodPolygonsVisible = visible;
      floodGroup.visible = visible;
      mapRef.current?.triggerRepaint();
    },
    setFloodLevelVisible(level, visible) {
      floodVisibleLevels[level] = visible;
      const mesh = floodLevelMeshes[level];
      if (mesh) {
        mesh.visible = visible;
        mapRef.current?.triggerRepaint();
      }
      // Re-colour 3D buildings so flood-tinted structures in the toggled
      // level revert to their normal grey (or re-appear when turned back on).
      if (floodHighlightActive && scene) scheduleRebuild();
    },
    setFloodPolygonOpacity(opacity) {
      floodPolygonOpacity = opacity;
      applyFloodOpacity();
      mapRef.current?.triggerRepaint();
    },
    setFloodVisualizationSettings(settings) {
      const rebuildGeometry = needsFloodGeometryRebuild(
        floodVisualizationSettings,
        settings,
      );
      floodVisualizationSettings = settings;
      if (rebuildGeometry && scene) {
        scheduleRebuildFlood();
      } else {
        for (const mesh of floodLineMeshes) {
          mesh.visible = settings.wireframeEnabled;
        }
        applyFloodOpacity();
      }
      mapRef.current?.triggerRepaint();
    },
    setAnimationsEnabled(enabled) {
      animationsEnabled = enabled;
      if (!enabled) {
        // Restore static facility pin positions so they don't freeze mid-bob.
        for (const { pointer, baseZ } of facilityPointers) {
          pointer.position.z = baseZ;
        }
        // Also reset flood materials to their base (non-pulsed) opacity.
        applyFloodOpacity(0, false);
      }
      mapRef.current?.triggerRepaint();
    },
    dispose() {
      for (const d of disposables.splice(0)) {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      }
      for (const d of floodDisposables.splice(0)) {
        try {
          d.dispose();
        } catch {
          /* noop */
        }
      }
      floodMaterials.length = 0;
      floodFillMaterials.length = 0;
      floodLineMaterials.length = 0;
      floodLineMeshes.length = 0;
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
    },
  };
}
