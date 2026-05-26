export type BuildingFeature = GeoJSON.Feature<
  GeoJSON.Polygon,
  {
    kind?: string;
    height?: number;
    minHeight?: number;
    name?: string;
    floodLevel?: "low" | "medium" | "high";
  }
>;

/** ~24 m edge proximity at Philippine latitudes (degrees). */
export const BUILDING_MATCH_MAX_EDGE_DIST_DEG = 0.00022;

export type IndexedBuilding = {
  feature: BuildingFeature;
  ring: GeoJSON.Position[];
  bbox: RingBBox;
  cx: number;
  cy: number;
  area: number;
};

export type RingBBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type BuildingSpatialIndex = {
  cells: Map<string, IndexedBuilding[]>;
  all: IndexedBuilding[];
  cellSize: number;
};

export type BuildingMatch = {
  feature: BuildingFeature;
  ring: GeoJSON.Position[];
  /** Facility coordinates lie inside the matched footprint. */
  contained: boolean;
};

export const BUILDING_INDEX_CELL_DEGREES = 0.003;

export function ringBBox(ring: GeoJSON.Position[]): RingBBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of ring) {
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  return { minX, minY, maxX, maxY };
}

export function ringArea(ring: GeoJSON.Position[]): number {
  let sum = 0;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) * 0.5;
}

export function pointInRing(
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
    const crosses = yi > lat !== yj > lat;
    const xIntersect = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses && lng < xIntersect) inside = !inside;
  }
  return inside;
}

function distancePointToSegment(
  lng: number,
  lat: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(lng - ax, lat - ay);
  let t = ((lng - ax) * dx + (lat - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = ax + t * dx;
  const py = ay + t * dy;
  return Math.hypot(lng - px, lat - py);
}

export function distancePointToRing(
  ring: GeoJSON.Position[],
  lng: number,
  lat: number,
): number {
  let min = Infinity;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const d = distancePointToSegment(
      lng,
      lat,
      ring[i][0],
      ring[i][1],
      ring[i + 1][0],
      ring[i + 1][1],
    );
    if (d < min) min = d;
  }
  return min;
}

export function closestPointOnRing(
  ring: GeoJSON.Position[],
  lng: number,
  lat: number,
): [number, number] {
  let bestLng = ring[0][0];
  let bestLat = ring[0][1];
  let min = Infinity;
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const ax = ring[i][0];
    const ay = ring[i][1];
    const bx = ring[i + 1][0];
    const by = ring[i + 1][1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((lng - ax) * dx + (lat - ay) * dy) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(lng - px, lat - py);
    if (d < min) {
      min = d;
      bestLng = px;
      bestLat = py;
    }
  }
  return [bestLng, bestLat];
}

export function ringCentroid(ring: GeoJSON.Position[]): [number, number] {
  const n = ring.length - 1;
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return [lng / n, lat / n];
}

function ringInteriorGridPoint(ring: GeoJSON.Position[]): [number, number] | null {
  const n = ring.length - 1;
  if (n < 3) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < n; i++) {
    const [x, y] = ring[i];
    if (x < minLng) minLng = x;
    if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  const spanLng = maxLng - minLng;
  const spanLat = maxLat - minLat;
  const cells = 10;
  let bestLng = 0;
  let bestLat = 0;
  let bestDist = -1;
  for (let ix = 0; ix <= cells; ix++) {
    for (let iy = 0; iy <= cells; iy++) {
      const gx = minLng + (spanLng * ix) / cells;
      const gy = minLat + (spanLat * iy) / cells;
      if (!pointInRing(ring, gx, gy)) continue;
      const dist = distancePointToRing(ring, gx, gy);
      if (dist > bestDist) {
        bestDist = dist;
        bestLng = gx;
        bestLat = gy;
      }
    }
  }
  if (bestDist < 0) return null;
  return [bestLng, bestLat];
}

/**
 * Best on-footprint anchor for a facility pin: prefer the facility point when
 * inside the ring, otherwise an interior pole-of-inaccessibility estimate, then
 * the vertex centroid when interior, otherwise the closest point on the boundary.
 */
export function ringLabelPoint(
  ring: GeoJSON.Position[],
  lng: number,
  lat: number,
): [number, number] {
  if (pointInRing(ring, lng, lat)) return [lng, lat];
  const grid = ringInteriorGridPoint(ring);
  if (grid) return grid;
  const [cx, cy] = ringCentroid(ring);
  if (pointInRing(ring, cx, cy)) return [cx, cy];
  return closestPointOnRing(ring, lng, lat);
}

export function buildBuildingSpatialIndex(
  buildings: BuildingFeature[],
  cellSize = BUILDING_INDEX_CELL_DEGREES,
): BuildingSpatialIndex {
  const cells = new Map<string, IndexedBuilding[]>();
  const all: IndexedBuilding[] = [];
  for (const feature of buildings) {
    const ring = feature.geometry.coordinates[0];
    if (!ring || ring.length < 4) continue;
    const bbox = ringBBox(ring);
    let cx = 0;
    let cy = 0;
    for (const c of ring) {
      cx += c[0];
      cy += c[1];
    }
    cx /= ring.length;
    cy /= ring.length;
    const item: IndexedBuilding = {
      feature,
      ring,
      bbox,
      cx,
      cy,
      area: ringArea(ring),
    };
    all.push(item);
    const minCellX = Math.floor(bbox.minX / cellSize);
    const maxCellX = Math.floor(bbox.maxX / cellSize);
    const minCellY = Math.floor(bbox.minY / cellSize);
    const maxCellY = Math.floor(bbox.maxY / cellSize);
    for (let ix = minCellX; ix <= maxCellX; ix++) {
      for (let iy = minCellY; iy <= maxCellY; iy++) {
        const id = `${ix}:${iy}`;
        const list = cells.get(id);
        if (list) list.push(item);
        else cells.set(id, [item]);
      }
    }
  }
  return { cells, all, cellSize };
}

function collectNearbyCandidates(
  lng: number,
  lat: number,
  index: BuildingSpatialIndex,
): IndexedBuilding[] {
  const centerX = Math.floor(lng / index.cellSize);
  const centerY = Math.floor(lat / index.cellSize);
  const nearby = new Set<IndexedBuilding>();
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const cell = index.cells.get(`${centerX + ox}:${centerY + oy}`);
      if (!cell) continue;
      for (const candidate of cell) nearby.add(candidate);
    }
  }
  return nearby.size > 0 ? Array.from(nearby) : index.all;
}

function isBetterMatch(
  next: IndexedBuilding,
  nextDist: number,
  nextContained: boolean,
  current: IndexedBuilding | null,
  currentDist: number,
  currentContained: boolean,
): boolean {
  if (!current) return true;
  if (nextContained && !currentContained) return true;
  if (!nextContained && currentContained) return false;
  if (nextDist < currentDist - 1e-12) return true;
  if (Math.abs(nextDist - currentDist) > 1e-12) return false;
  return next.area < current.area;
}

/**
 * Match a facility point to a building footprint when the point is inside the
 * polygon or within ``BUILDING_MATCH_MAX_EDGE_DIST_DEG`` of its boundary.
 * Nearest-centroid matching across unrelated buildings is intentionally omitted.
 */
export function findBuildingMatch(
  lng: number,
  lat: number,
  index: BuildingSpatialIndex,
  maxEdgeDist = BUILDING_MATCH_MAX_EDGE_DIST_DEG,
): BuildingMatch | null {
  const candidates = collectNearbyCandidates(lng, lat, index);
  let best: IndexedBuilding | null = null;
  let bestDist = Infinity;
  let bestContained = false;

  for (const item of candidates) {
    if (
      lng < item.bbox.minX - maxEdgeDist ||
      lng > item.bbox.maxX + maxEdgeDist ||
      lat < item.bbox.minY - maxEdgeDist ||
      lat > item.bbox.maxY + maxEdgeDist
    ) {
      continue;
    }

    const contained = pointInRing(item.ring, lng, lat);
    const edgeDist = contained ? 0 : distancePointToRing(item.ring, lng, lat);
    if (!contained && edgeDist > maxEdgeDist) continue;

    if (isBetterMatch(item, edgeDist, contained, best, bestDist, bestContained)) {
      best = item;
      bestDist = edgeDist;
      bestContained = contained;
    }
  }

  if (!best) return null;
  return {
    feature: best.feature,
    ring: best.ring,
    contained: bestContained,
  };
}

export function resolveFacilityPinLngLat(
  lng: number,
  lat: number,
  match: BuildingMatch | null,
): [number, number] {
  if (!match) return [lng, lat];
  return ringLabelPoint(match.ring, lng, lat);
}

export function buildingPolygonKey(feature: BuildingFeature): string | null {
  const ring = feature.geometry.coordinates[0];
  const origin = ring?.[0];
  if (!origin) return null;
  return `${origin[0].toFixed(6)},${origin[1].toFixed(6)}`;
}
