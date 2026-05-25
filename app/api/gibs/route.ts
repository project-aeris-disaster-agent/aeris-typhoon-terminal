import { jsonOk } from "@/lib/api-response";
import { GIBS_WMTS } from "@/services/satellite-frames";

export const runtime = "edge";
export const revalidate = 3600;

/**
 * Metadata for Himawari GIBS presets used by the live-weather overlay.
 *
 * The shape is **derived from `GIBS_WMTS`**, the same constant the client uses
 * to build tile URLs at runtime. Keeping a single source of truth avoids the
 * historical drift where this route documented different layer ids and tile
 * matrix sets than the client actually requested.
 *
 * Tiles load directly in the browser from `gibs.earthdata.nasa.gov`
 * (CORS-friendly); this endpoint is metadata-only and intended for diagnostics
 * / external integrations.
 */
export async function GET() {
  const layers = Object.fromEntries(
    Object.entries(GIBS_WMTS).map(([key, spec]) => [
      key,
      {
        id: spec.layerId,
        tileMatrixSet: spec.matrix,
        maxZoom: spec.maxzoom,
        label: spec.label,
      },
    ]),
  );

  return jsonOk(
    {
      layers,
      attribution: "NASA GIBS / Himawari-9",
      projection: "EPSG:3857",
      tileUrlTemplate:
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layerId}/default/{time}/{tileMatrixSet}/{z}/{y}/{x}.png",
      timeFormat: "YYYY-MM-DDTHH:mm:00Z (UTC, floored to 10-minute boundary)",
      publishLagMinutes: 35,
    },
    3600,
  );
}
