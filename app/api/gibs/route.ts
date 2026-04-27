import { jsonOk } from "@/lib/api-response";

export const runtime = "edge";
export const revalidate = 3600;

/**
 * Metadata for Himawari GIBS presets (layer id + tile matrix set per mode).
 * Tiles load in the browser from gibs.earthdata.nasa.gov (CORS-friendly).
 */
export async function GET() {
  return jsonOk(
    {
      layers: {
        "himawari-true": {
          id: "Himawari_AHI_Band3_Red_Visible_1km",
          tileMatrixSet: "GoogleMapsCompatible_Level7",
          maxZoom: 6,
          label: "Himawari visible (Band 3)",
        },
        "himawari-ir": {
          id: "Himawari_AHI_Band13_Clean_Infrared",
          tileMatrixSet: "GoogleMapsCompatible_Level6",
          maxZoom: 6,
          label: "Himawari infrared (Band 13)",
        },
      },
      attribution: "NASA GIBS / Himawari-9",
    },
    3600,
  );
}
