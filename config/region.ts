/**
 * Philippines geographic constants.
 *
 * The dashboard is region-locked to the Philippine archipelago. All map
 * interactions (pan, zoom, 3D camera) are constrained to these bounds. The
 * PAR polygon is the Philippine Area of Responsibility used by PAGASA for
 * typhoon advisories.
 */

export type BBox = [number, number, number, number];
export type LngLat = [number, number];

export const PH_BBOX: BBox = [116.0, 4.5, 127.0, 21.5];

/** Axis-aligned bounds covering the PAR polygon (PAGASA advisory area). */
export const PAR_BBOX: BBox = [115.0, 5.0, 135.0, 25.0];

export const PH_CENTER: LngLat = [122.0, 12.5];

export const PH_MAX_BOUNDS: [[number, number], [number, number]] = [
  [114.0, 2.5],
  [129.5, 23.5],
];

export const DEFAULT_ZOOM = 5.4;
/** Lower = wider view; tuned so the full PH footprint fits typical desktop + mobile viewports. */
export const MIN_ZOOM = 3.85;
export const MAX_ZOOM = 17;

/**
 * Philippine Area of Responsibility (PAR) polygon per PAGASA definition.
 * Coordinates: 5N 115E, 15N 115E, 21N 120E, 25N 120E, 25N 135E, 5N 135E.
 */
export const PAR_POLYGON: LngLat[] = [
  [115.0, 5.0],
  [115.0, 15.0],
  [120.0, 21.0],
  [120.0, 25.0],
  [135.0, 25.0],
  [135.0, 5.0],
  [115.0, 5.0],
];

export const PH_REGIONS: { code: string; name: string; center: LngLat }[] = [
  { code: "NCR", name: "Metro Manila", center: [120.9842, 14.5995] },
  { code: "CAR", name: "Cordillera", center: [120.8, 17.1] },
  { code: "R1", name: "Ilocos", center: [120.55, 17.5] },
  { code: "R2", name: "Cagayan Valley", center: [121.8, 17.2] },
  { code: "R3", name: "Central Luzon", center: [120.7, 15.3] },
  { code: "R4A", name: "CALABARZON", center: [121.3, 14.1] },
  { code: "R4B", name: "MIMAROPA", center: [120.9, 12.5] },
  { code: "R5", name: "Bicol", center: [123.4, 13.5] },
  { code: "R6", name: "Western Visayas", center: [122.55, 10.72] },
  { code: "R7", name: "Central Visayas", center: [123.9, 10.3] },
  { code: "R8", name: "Eastern Visayas", center: [125.0, 11.5] },
  { code: "R9", name: "Zamboanga Peninsula", center: [122.1, 7.3] },
  { code: "R10", name: "Northern Mindanao", center: [124.6, 8.5] },
  { code: "R11", name: "Davao", center: [125.6, 7.1] },
  { code: "R12", name: "SOCCSKSARGEN", center: [124.7, 6.5] },
  { code: "R13", name: "Caraga", center: [125.8, 9.0] },
  { code: "BARMM", name: "Bangsamoro", center: [124.3, 7.2] },
];
