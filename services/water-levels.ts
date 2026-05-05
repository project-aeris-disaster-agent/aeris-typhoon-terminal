import maplibregl, { type Map as MLMap } from "maplibre-gl";

type WaterLevelStation = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  stationType: "pagasa" | "mmda" | "unknown";
  current: number | null;
  alert: number | null;
  alarm: number | null;
  critical: number | null;
  updatedAt: string | null;
  level: "normal" | "alert" | "alarm" | "critical" | "nodata";
};

type WaterLevelsResponse = {
  updatedAt: string | null;
  stations: WaterLevelStation[];
};

const WATER_LEVELS_SOURCE_ID = "src-pagasa-water-levels";
const WATER_LEVELS_POINTS_LAYER_ID = "lyr-pagasa-water-level-points";
const WATER_LEVELS_LABELS_LAYER_ID = "lyr-pagasa-water-level-labels";

function toFeatureCollection(stations: WaterLevelStation[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => {
      const currentText =
        station.current === null ? "No Data" : `${station.current.toFixed(2)}m`;
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [station.lon, station.lat],
        },
        properties: {
          id: station.id,
          name: station.name,
          level: station.level,
          stationType: station.stationType,
          current: station.current,
          currentText,
          updatedAt: station.updatedAt ?? "",
        },
      } as GeoJSON.Feature;
    }),
  };
}

export async function fetchWaterLevels(): Promise<WaterLevelsResponse> {
  const res = await fetch("/api/pagasa-water-levels", { cache: "no-store" });
  if (!res.ok) throw new Error(`water levels ${res.status}`);
  const data = (await res.json()) as Partial<WaterLevelsResponse>;
  return {
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    stations: Array.isArray(data.stations) ? data.stations : [],
  };
}

export function renderWaterLevelsOnMap(map: MLMap, stations: WaterLevelStation[]): void {
  const data = toFeatureCollection(stations);
  const src = map.getSource(WATER_LEVELS_SOURCE_ID);
  if (src && "setData" in src) {
    (src as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(WATER_LEVELS_SOURCE_ID, { type: "geojson", data });
  }

  const beforeId = map.getLayer("lyr-osm-facility-labels")
    ? "lyr-osm-facility-labels"
    : undefined;

  if (!map.getLayer(WATER_LEVELS_POINTS_LAYER_ID)) {
    map.addLayer(
      {
        id: WATER_LEVELS_POINTS_LAYER_ID,
        type: "circle",
        source: WATER_LEVELS_SOURCE_ID,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 7],
          "circle-color": [
            "match",
            ["get", "level"],
            "critical",
            "#dc2626",
            "alarm",
            "#f97316",
            "alert",
            "#facc15",
            "nodata",
            "#6b7280",
            "#22c55e",
          ],
          "circle-stroke-color": "#f8fafc",
          "circle-stroke-width": 1.25,
          "circle-opacity": 0.92,
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(WATER_LEVELS_LABELS_LAYER_ID)) {
    map.addLayer(
      {
        id: WATER_LEVELS_LABELS_LAYER_ID,
        type: "symbol",
        source: WATER_LEVELS_SOURCE_ID,
        layout: {
          "text-field": ["concat", ["get", "name"], " ", ["get", "currentText"]],
          "text-size": 10,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#dbeafe",
          "text-halo-color": "#0b1220",
          "text-halo-width": 1.2,
          "text-opacity": 0.95,
        },
      },
      beforeId,
    );
  }
}

export function setWaterLevelsVisibility(map: MLMap, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  if (map.getLayer(WATER_LEVELS_POINTS_LAYER_ID)) {
    map.setLayoutProperty(WATER_LEVELS_POINTS_LAYER_ID, "visibility", visibility);
  }
  if (map.getLayer(WATER_LEVELS_LABELS_LAYER_ID)) {
    map.setLayoutProperty(WATER_LEVELS_LABELS_LAYER_ID, "visibility", visibility);
  }
}
