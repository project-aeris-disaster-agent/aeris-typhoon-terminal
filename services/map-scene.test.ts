import {
  selectSceneBuildingsForTest,
  type BuildingRenderScope,
} from "./map-scene";
import type { BuildingFeature, FacilityFeature } from "./three-scene";

function building(
  name: string,
  west: number,
  south: number,
  east: number,
  north: number,
): BuildingFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]],
    },
    properties: { kind: "building", name, height: 10, minHeight: 0 },
  };
}

function facility(
  name: string,
  lon: number,
  lat: number,
  priority?: number,
): FacilityFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { category: "government", name, ...(priority !== undefined ? { priority } : {}) },
  };
}

function select(scope: BuildingRenderScope) {
  const facilityBuilding = building("facility", 0, 0, 0.001, 0.001);
  const nearbyAmbient = building("ambient", 0.002, 0, 0.003, 0.001);
  const pinned = building("pinned", 0.004, 0, 0.005, 0.001);
  const result = selectSceneBuildingsForTest(
    [facilityBuilding, nearbyAmbient],
    [facility("barangay hall", 0.0005, 0.0005, 1)],
    [pinned],
    scope,
    { lon: 0, lat: 0 },
  );
  return { result, facilityBuilding, nearbyAmbient, pinned };
}

describe("map-scene building selection", () => {
  it("keeps only facility-linked and pinned buildings in facility-only scope", () => {
    const { result, facilityBuilding, pinned } = select("facility-only");

    expect(result.immediateBuildings).toEqual([facilityBuilding, pinned]);
    expect(result.deferredBuildings).toEqual([]);
    expect(result.facilities).toHaveLength(1);
  });

  it("defers ambient buildings in context scope", () => {
    const { result, facilityBuilding, nearbyAmbient, pinned } = select("context");

    expect(result.immediateBuildings).toEqual([facilityBuilding, pinned]);
    expect(result.deferredBuildings).toEqual([nearbyAmbient]);
  });

  it("prefers containing footprint over a closer centroid fallback", () => {
    const containing = building("containing", 0, 0, 0.01, 0.01);
    const closerCentroid = building("closer-centroid", 0.0006, 0.0006, 0.0008, 0.0008);
    const result = selectSceneBuildingsForTest(
      [containing, closerCentroid],
      [facility("hospital", 0.0002, 0.0002, 5)],
      [],
      "facility-only",
      { lon: 0, lat: 0 },
    );

    expect(result.immediateBuildings).toEqual([containing]);
  });

  it("filters unknown-priority facilities out of facility building selection", () => {
    const known = building("known", 0, 0, 0.001, 0.001);
    const unknown = building("unknown", 0.002, 0, 0.003, 0.001);
    const result = selectSceneBuildingsForTest(
      [known, unknown],
      [
        facility("known", 0.0005, 0.0005, 1),
        facility("unknown", 0.0025, 0.0005),
      ],
      [],
      "facility-only",
      { lon: 0, lat: 0 },
    );

    expect(result.immediateBuildings).toEqual([known]);
    expect(result.facilities).toHaveLength(1);
  });
});
