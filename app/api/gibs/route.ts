import { jsonOk } from "@/lib/api-response";

export const runtime = "edge";
export const revalidate = 3600;

/**
 * Metadata endpoint for GIBS layers available to the client. Actual tile
 * fetching happens directly from the browser against GIBS CDN — WMTS tiles
 * are public and CORS-friendly.
 */
export async function GET() {
  return jsonOk(
    {
      base:
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png",
      layers: {
        "himawari-true": {
          id: "AHI_Geocolor",
          label: "Himawari True Color",
        },
        "himawari-ir": {
          id: "AHI_Band13_Clean_Infrared_Brightness_Temperature",
          label: "Himawari Infrared",
        },
      },
      attribution: "NASA GIBS / Himawari-9",
    },
    3600,
  );
}
