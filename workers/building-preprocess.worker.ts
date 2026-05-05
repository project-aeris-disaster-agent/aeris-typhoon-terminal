type FloodLevel = "low" | "medium" | "high";
type BucketKey = "normal" | FloodLevel;

type BuildingFeature = GeoJSON.Feature<
  GeoJSON.Polygon,
  {
    kind?: string;
    height?: number;
    minHeight?: number;
    floodLevel?: FloodLevel;
  }
>;

type BuildingPreprocessRequest = {
  taskId: number;
  origin: { x: number; y: number };
  meterScale: number;
  floodHighlightActive: boolean;
  floodVisibleLevels: Record<FloodLevel, boolean>;
  buildingPalette: Record<string, number>;
  floodBuildingPalette: Record<FloodLevel, number>;
  features: BuildingFeature[];
};

type PreprocessedBuilding = {
  bucket: BucketKey;
  minHeight: number;
  depth: number;
  points: Array<[number, number]>;
  color: [number, number, number];
};

type BuildingPreprocessResponse = {
  taskId: number;
  items: PreprocessedBuilding[];
};

function lngLatToMercator(lng: number, lat: number): { x: number; y: number } {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

function hexToRgb01(hex: number): [number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return [r, g, b];
}

function mulColor(
  rgb: [number, number, number],
  scalar: number,
): [number, number, number] {
  return [rgb[0] * scalar, rgb[1] * scalar, rgb[2] * scalar];
}

self.onmessage = (event: MessageEvent<BuildingPreprocessRequest>) => {
  const {
    taskId,
    features,
    origin,
    meterScale,
    floodHighlightActive,
    floodVisibleLevels,
    buildingPalette,
    floodBuildingPalette,
  } = event.data;
  const out: PreprocessedBuilding[] = [];

  for (const feat of features) {
    const props = feat.properties ?? {};
    const kind = typeof props.kind === "string" ? props.kind : "building";
    const height = Math.max(4, typeof props.height === "number" ? props.height : 10);
    const minHeight = Math.max(
      0,
      typeof props.minHeight === "number" ? props.minHeight : 0,
    );
    const depth = Math.max(2, height - minHeight);
    const ring = feat.geometry.coordinates[0];
    if (!ring || ring.length < 4) continue;

    const points: Array<[number, number]> = [];
    for (let i = 0; i < ring.length; i++) {
      const merc = lngLatToMercator(ring[i][0], ring[i][1]);
      const dx = (merc.x - origin.x) / meterScale;
      const dy = -(merc.y - origin.y) / meterScale;
      points.push([dx, dy]);
    }
    if (points.length < 4) continue;

    const floodLevel = props.floodLevel;
    const isFlooded =
      floodHighlightActive &&
      floodLevel !== undefined &&
      floodVisibleLevels[floodLevel];
    const baseColor = isFlooded
      ? floodBuildingPalette[floodLevel!]
      : (buildingPalette[kind] ?? buildingPalette.building);
    const seed = Math.abs(Math.sin(ring[0][0] * 127.1 + ring[0][1] * 311.7));
    const jitter = isFlooded ? 1 : 0.9 + ((seed * 1000) % 1) * 0.2;
    const rgb = mulColor(hexToRgb01(baseColor), jitter);
    out.push({
      bucket: isFlooded ? floodLevel! : "normal",
      minHeight,
      depth,
      points,
      color: rgb,
    });
  }

  const payload: BuildingPreprocessResponse = { taskId, items: out };
  self.postMessage(payload);
};
