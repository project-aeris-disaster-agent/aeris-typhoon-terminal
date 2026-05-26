import {
  BUILDING_MATCH_MAX_EDGE_DIST_DEG,
  buildBuildingSpatialIndex,
  closestPointOnRing,
  distancePointToRing,
  findBuildingMatch,
  pointInRing,
  resolveFacilityPinLngLat,
  ringLabelPoint,
  type BuildingFeature,
} from "@/lib/facility-building-match";

function squareBuilding(
  west: number,
  south: number,
  east: number,
  north: number,
  height = 12,
): BuildingFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
    properties: { height },
  };
}

describe("facility-building-match", () => {
  const hospital = squareBuilding(123.18, 13.62, 123.181, 13.621, 18);
  const neighbor = squareBuilding(123.182, 13.62, 123.183, 13.621, 10);
  const index = buildBuildingSpatialIndex([hospital, neighbor]);

  it("matches a facility inside a footprint", () => {
    const match = findBuildingMatch(123.1805, 13.6205, index);
    expect(match).not.toBeNull();
    expect(match?.feature).toBe(hospital);
    expect(match?.contained).toBe(true);
  });

  it("does not match a distant facility to an unrelated centroid", () => {
    const match = findBuildingMatch(123.19, 13.63, index);
    expect(match).toBeNull();
  });

  it("matches a facility just outside the footprint within edge tolerance", () => {
    const lng = 123.181 + BUILDING_MATCH_MAX_EDGE_DIST_DEG * 0.5;
    const match = findBuildingMatch(lng, 13.6205, index);
    expect(match).not.toBeNull();
    expect(match?.feature).toBe(hospital);
    expect(match?.contained).toBe(false);
  });

  it("prefers the smaller containing building when footprints overlap", () => {
    const big = squareBuilding(123.17, 13.61, 123.19, 13.63, 30);
    const small = squareBuilding(123.175, 13.615, 123.178, 13.618, 12);
    const overlapIndex = buildBuildingSpatialIndex([big, small]);
    const match = findBuildingMatch(123.1765, 13.6165, overlapIndex);
    expect(match?.feature).toBe(small);
    expect(match?.contained).toBe(true);
  });

  it("anchors pins on the footprint when the facility node sits outside", () => {
    const ring = hospital.geometry.coordinates[0];
    const outsideLng = 123.181 + BUILDING_MATCH_MAX_EDGE_DIST_DEG * 0.4;
    const match = findBuildingMatch(outsideLng, 13.6205, index);
    const [pinLng, pinLat] = resolveFacilityPinLngLat(
      outsideLng,
      13.6205,
      match,
    );
    expect(pointInRing(ring, pinLng, pinLat)).toBe(true);
    expect(distancePointToRing(ring, pinLng, pinLat)).toBeGreaterThan(0);
  });

  it("uses ringLabelPoint centroid for L-shaped footprints when the node is outside", () => {
    const lShape: GeoJSON.Position[] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
      [0, 0],
    ];
    const [lng, lat] = ringLabelPoint(lShape, 3.5, 3.5);
    expect(pointInRing(lShape, lng, lat)).toBe(true);
    expect([lng, lat]).not.toEqual([3.5, 3.5]);
  });

  it("closestPointOnRing snaps to the nearest edge", () => {
    const ring = hospital.geometry.coordinates[0];
    const [lng, lat] = closestPointOnRing(ring, 123.1815, 13.6205);
    expect(distancePointToRing(ring, lng, lat)).toBeLessThan(1e-9);
  });
});
