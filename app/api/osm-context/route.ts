import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/kv";
import { jsonError } from "@/lib/api-response";
import { PH_BBOX } from "@/config/region";
import {
  buildFacilityCode,
  buildFacilityId,
  contactFieldsFromOsmTags,
} from "@/lib/facility-display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Point = [number, number];

type OverpassElement = {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements: OverpassElement[];
};

type FeatureProperties = Record<string, string | number | boolean | null>;

const OVERPASS_ENDPOINTS = [
  "http://overpass-api.de/api/interpreter",
  "http://lz4.overpass-api.de/api/interpreter",
  "http://overpass.kumi.systems/api/interpreter",
];
const CACHE_TTL_SECONDS = 10 * 60;
/** Long-lived "last good" copy served when every Overpass mirror is down. */
const STALE_TTL_SECONDS = 6 * 60 * 60;
/** Public Overpass mirrors are slow; give each a generous per-request budget. */
const OVERPASS_TIMEOUT_MS = 20_000;

type ContextPayload = ReturnType<typeof buildPayload>;

export async function GET(request: NextRequest) {
  const bboxText = request.nextUrl.searchParams.get("bbox");
  const zoomText = request.nextUrl.searchParams.get("zoom");

  if (!bboxText) {
    return jsonError("Missing bbox query param.", 400);
  }

  const bbox = parseBbox(bboxText);
  if (!bbox) {
    return jsonError("Invalid bbox query param.", 400);
  }

  const zoom = Number(zoomText ?? "0");
  const keySuffix = `${bbox.map((value) => value.toFixed(3)).join(",")}:${Math.round(zoom * 10)}`;
  const cacheKey = `osm-context:${keySuffix}`;
  const staleKey = `osm-context-stale:${keySuffix}`;
  const cached = await store.get<ContextPayload>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: {
        "cache-control": "public, max-age=300, s-maxage=600, stale-while-revalidate=300",
      },
    });
  }

  const query = buildOverpassQuery(bbox, zoom);
  const encodedQuery = encodeURIComponent(query);
  let response: Response | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    let candidate: Response | null = null;
    try {
      candidate = await fetch(`${endpoint}?data=${encodedQuery}`, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "aeris-typhoon-terminal/1.0 (+http://localhost)",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
    } catch (error) {
      console.warn(`OSM context fetch failed for ${endpoint}:`, error);
      continue;
    }
    if (candidate.ok) {
      response = candidate;
      break;
    }
  }
  if (!response) return serveStaleOrError(staleKey, "Failed to fetch OpenStreetMap context.");

  const data = (await response.json()) as unknown;
  if (!isOverpassResponse(data)) {
    return serveStaleOrError(staleKey, "OpenStreetMap context payload was invalid.");
  }
  const payload = buildPayload(data.elements);
  await store.set(cacheKey, payload, CACHE_TTL_SECONDS);
  await store.set(staleKey, payload, STALE_TTL_SECONDS);

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=300, s-maxage=600, stale-while-revalidate=300",
    },
  });
}

/**
 * Serve the last-known-good context (flagged `degraded`) when every Overpass
 * mirror is unreachable, falling back to a 502 only when no cache exists.
 */
async function serveStaleOrError(staleKey: string, message: string) {
  const stale = await store.get<ContextPayload>(staleKey);
  if (stale) {
    return NextResponse.json(
      { ...stale, degraded: true },
      {
        status: 200,
        headers: { "cache-control": "no-store" },
      },
    );
  }
  return jsonError(message, 502);
}

function parseBbox(text: string): [number, number, number, number] | null {
  const parts = text.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [west, south, east, north] = parts;
  if (
    west >= east ||
    south >= north ||
    west < PH_BBOX[0] ||
    east > PH_BBOX[2] ||
    south < PH_BBOX[1] ||
    north > PH_BBOX[3]
  ) {
    return null;
  }

  return [west, south, east, north];
}

function buildOverpassQuery(
  [west, south, east, north]: [number, number, number, number],
  zoom: number,
) {
  const buildingClauses = zoom >= 11.5
    ? `
      way["building"](${south},${west},${north},${east});
    `
    : "";

  const roadMatcher = zoom >= 11
    ? "motorway|trunk|primary|secondary|tertiary|residential|service|unclassified|living_street"
    : zoom >= 9
      ? "motorway|trunk|primary|secondary|tertiary"
      : "motorway|trunk|primary|secondary";

  return `
[out:json][timeout:25];
(
  way["highway"~"${roadMatcher}"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  way["waterway"="riverbank"](${south},${west},${north},${east});
  way["landuse"~"reservoir|basin"](${south},${west},${north},${east});
  ${buildingClauses}
  node["amenity"~"hospital|clinic|police|fire_station|school|university|townhall|college"](${south},${west},${north},${east});
  way["amenity"~"hospital|clinic|police|fire_station|school|university|townhall|college"](${south},${west},${north},${east});
  node["emergency"~"assembly_point|ambulance_station|evacuation_centre"](${south},${west},${north},${east});
  way["emergency"~"assembly_point|ambulance_station|evacuation_centre"](${south},${west},${north},${east});
  node["office"="government"](${south},${west},${north},${east});
  way["office"="government"](${south},${west},${north},${east});
  node["building"="government"](${south},${west},${north},${east});
  way["building"="government"](${south},${west},${north},${east});
);
out geom qt;
`;
}

function buildPayload(elements: OverpassElement[]) {
  const roads: GeoJSON.Feature[] = [];
  const water: GeoJSON.Feature[] = [];
  const buildings: GeoJSON.Feature[] = [];
  const facilities: GeoJSON.Feature[] = [];
  const facilityKeys = new Set<string>();

  for (const element of elements) {
    const tags = element.tags ?? {};

    if (element.type === "node" && isFacility(tags) && element.lon && element.lat) {
      const coords: Point = [element.lon, element.lat];
      pushFacilityFeature(
        facilities,
        facilityKeys,
        coords,
        facilityProperties(tags, coords, element.id),
      );
      continue;
    }

    const coords = element.geometry?.map((point) => [point.lon, point.lat] as Point) ?? [];
    if (coords.length < 2) continue;

    if (isRoad(tags)) {
      roads.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
        properties: roadProperties(tags),
      });
    }

    if (isPolygon(coords) && isWater(tags)) {
      water.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [ensureClosed(coords)],
        },
        properties: {
          kind: "water",
        },
      });
    }

    if (isPolygon(coords) && isBuilding(tags)) {
      buildings.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [ensureClosed(coords)],
        },
        properties: buildingProperties(tags),
      });
    }

    if (isFacility(tags)) {
      const centroid = polygonCentroid(coords);
      pushFacilityFeature(
        facilities,
        facilityKeys,
        centroid,
        facilityProperties(tags, centroid, element.id),
      );
    }
  }

  return {
    buildings: featureCollection(buildings),
    roads: featureCollection(roads),
    water: featureCollection(water),
    facilities: featureCollection(facilities),
    generatedAt: new Date().toISOString(),
    attribution: "OpenStreetMap contributors",
  };
}

function isOverpassResponse(value: unknown): value is OverpassResponse {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<OverpassResponse>;
  return Array.isArray(payload.elements);
}

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features,
  };
}

function isRoad(tags: Record<string, string>) {
  return Boolean(tags.highway);
}

function isWater(tags: Record<string, string>) {
  return (
    tags.natural === "water" ||
    tags.waterway === "riverbank" ||
    tags.landuse === "reservoir" ||
    tags.landuse === "basin"
  );
}

function isBuilding(tags: Record<string, string>) {
  return Boolean(tags.building && tags.building !== "no");
}

function isFacility(tags: Record<string, string>) {
  return Boolean(
    tags.amenity ||
      tags.emergency ||
      tags.office === "government" ||
      tags.building === "government",
  );
}

function ensureClosed(coords: Point[]) {
  if (coords.length === 0) return coords;
  const [firstLng, firstLat] = coords[0];
  const [lastLng, lastLat] = coords[coords.length - 1];
  if (firstLng === lastLng && firstLat === lastLat) return coords;
  return [...coords, coords[0]];
}

function isPolygon(coords: Point[]) {
  if (coords.length < 4) return false;
  const [firstLng, firstLat] = coords[0];
  const [lastLng, lastLat] = coords[coords.length - 1];
  return firstLng === lastLng && firstLat === lastLat;
}

function polygonCentroid(coords: Point[]): Point {
  const points = ensureClosed(coords).slice(0, -1);
  const [sumLng, sumLat] = points.reduce(
    (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
    [0, 0],
  );
  return [sumLng / points.length, sumLat / points.length];
}

function roadProperties(tags: Record<string, string>): FeatureProperties {
  const roadClass = tags.highway ?? "road";
  const strokeWidth = roadWidth(roadClass);
  return {
    roadClass,
    strokeWidth,
    name: tags.name ?? null,
  };
}

function roadWidth(roadClass: string) {
  switch (roadClass) {
    case "motorway":
      return 2.6;
    case "trunk":
      return 2.2;
    case "primary":
      return 1.8;
    case "secondary":
      return 1.4;
    case "tertiary":
      return 1.1;
    default:
      return 0.9;
  }
}

function buildingProperties(tags: Record<string, string>): FeatureProperties {
  const levels = Number.parseFloat(tags["building:levels"] ?? "");
  const explicitHeight = parseHeight(tags.height);
  const minHeight = parseHeight(tags["min_height"]);
  const kind = buildingKind(tags);

  return {
    kind,
    height:
      explicitHeight ??
      (Number.isFinite(levels) ? Math.max(4, levels * 3.2) : defaultBuildingHeight(kind)),
    minHeight: minHeight ?? 0,
    name: tags.name ?? null,
  };
}

function parseHeight(value: string | undefined) {
  if (!value) return null;
  const numeric = Number.parseFloat(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function defaultBuildingHeight(kind: string) {
  switch (kind) {
    case "hospital":
      return 18;
    case "government":
      return 16;
    case "school":
      return 14;
    case "industrial":
      return 12;
    default:
      return 10;
  }
}

function buildingKind(tags: Record<string, string>) {
  if (tags.amenity === "hospital" || tags.amenity === "clinic") return "hospital";
  if (tags.amenity === "school" || tags.amenity === "college" || tags.amenity === "university") {
    return "school";
  }
  if (tags.office === "government" || tags.building === "government" || tags.amenity === "townhall") {
    return "government";
  }
  if (tags.building === "industrial" || tags.building === "warehouse") return "industrial";
  return "building";
}

function facilityProperties(
  tags: Record<string, string>,
  coordinates: Point,
  osmId?: number,
): FeatureProperties {
  const category = facilityCategory(tags);
  const contact = contactFieldsFromOsmTags(tags);
  const [lon, lat] = coordinates;
  return {
    category,
    categoryLabel: facilityLabel(category),
    name: tags.name ?? facilityLabel(category),
    priority: facilityPriority(category),
    source: "OpenStreetMap",
    facilityId: buildFacilityId(category, lon, lat, osmId),
    facilityCode: buildFacilityCode(category, lon, lat),
    osmId: osmId ?? null,
    contactPhone: contact.contactPhone ?? null,
    contactEmail: contact.contactEmail ?? null,
    contactWeb: contact.contactWeb ?? null,
    contact: contact.contact ?? null,
  };
}

function facilityCategory(tags: Record<string, string>) {
  if (tags.amenity === "hospital" || tags.amenity === "clinic") return "hospital";
  if (tags.amenity === "fire_station") return "fire_station";
  if (tags.amenity === "police") return "police";
  if (tags.amenity === "school" || tags.amenity === "college" || tags.amenity === "university") {
    return "school";
  }
  if (tags.emergency === "assembly_point" || tags.emergency === "evacuation_centre") {
    return "evacuation";
  }
  return "government";
}

function facilityLabel(category: string) {
  switch (category) {
    case "hospital":
      return "Hospital / Clinic";
    case "fire_station":
      return "Fire Station";
    case "police":
      return "Police";
    case "school":
      return "School / Campus";
    case "evacuation":
      return "Evacuation Site";
    default:
      return "Government Facility";
  }
}

function facilityPriority(category: string) {
  switch (category) {
    case "hospital":
      return 5;
    case "evacuation":
      return 4;
    case "fire_station":
      return 3;
    case "police":
      return 2;
    default:
      return 1;
  }
}

function pushFacilityFeature(
  facilities: GeoJSON.Feature[],
  facilityKeys: Set<string>,
  coordinates: Point,
  properties: FeatureProperties,
) {
  const key = [
    properties.category ?? "other",
    String(properties.name ?? "facility").toLowerCase(),
    coordinates[0].toFixed(5),
    coordinates[1].toFixed(5),
  ].join("|");

  if (facilityKeys.has(key)) return;
  facilityKeys.add(key);
  facilities.push({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates,
    },
    properties,
  });
}
