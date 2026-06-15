"use client";

import maplibregl, { Map as MLMap, Popup } from "maplibre-gl";
import { layerBeforeDynamicOverlays, whenStyleReady } from "@/config/map-layers";
import type { YtVideo } from "@/services/youtube-feeds";
import { getEmbedUrl } from "@/services/youtube-feeds";

const SOURCE_ID = "webcam-pings";
const HALO_LAYER_ID = "webcam-pings-halo";
const ICON_LAYER_ID = "webcam-pings-icon";
const CAMERA_ICON_ID = "aeris-cctv-camera";

/** Public so other modules (e.g. hazard popup) can avoid double-handling clicks. */
export const WEBCAM_MAP_LAYER_IDS = [HALO_LAYER_ID, ICON_LAYER_ID] as const;

/** Halo color — a soft cyan glow that remains visible against light & dark basemaps. */
const HALO_LIVE = "#38bdf8";
const HALO_RECENT = "#94a3b8";

const popups = new WeakMap<MLMap, Popup>();
const handlers = new WeakMap<MLMap, () => void>();

type WebcamFeatureProps = {
  videoId: string;
  title: string;
  channelName: string;
  channelHandle: string;
  locationLabel: string;
  isLive: boolean;
};

function toFeatureCollection(
  videos: YtVideo[],
): GeoJSON.FeatureCollection<GeoJSON.Point, WebcamFeatureProps> {
  const features: GeoJSON.Feature<GeoJSON.Point, WebcamFeatureProps>[] = [];
  for (const v of videos) {
    if (!v.location) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [v.location.lon, v.location.lat] },
      properties: {
        videoId: v.id,
        title: v.title,
        channelName: v.channelName,
        channelHandle: v.channelHandle,
        locationLabel: v.location.label,
        isLive: Boolean(v.isLikeLive),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * CCTV camera icon — flat dome-camera silhouette in cyan-on-dark with a tiny
 * red recording dot. Rendered as an inline SVG so we don't ship a binary
 * asset; rasterized once per map and re-registered after style reloads.
 */
function buildCameraIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#0b1721" flood-opacity="0.55"/>
    </filter>
  </defs>
  <g filter="url(#s)">
    <rect x="10" y="20" width="34" height="20" rx="3" fill="#0ea5e9" stroke="#06384a" stroke-width="1.5"/>
    <rect x="44" y="24" width="10" height="12" rx="1.5" fill="#0ea5e9" stroke="#06384a" stroke-width="1.5"/>
    <circle cx="20" cy="30" r="5" fill="#0b1721" stroke="#7dd3fc" stroke-width="1.2"/>
    <circle cx="20" cy="30" r="2" fill="#7dd3fc"/>
    <rect x="22" y="40" width="10" height="6" rx="1" fill="#06384a"/>
    <circle cx="38" cy="24.5" r="1.6" fill="#ef4444"/>
  </g>
</svg>`;
}

/**
 * Rasterize the SVG once and register it with MapLibre. Resolves true on
 * success, false if the browser blocked the load (rare; falls back to a plain
 * dot). Called both on initial render and after `styledata` reloads, since
 * MapLibre purges custom images during a style swap.
 */
async function ensureCameraIcon(map: MLMap): Promise<boolean> {
  if (map.hasImage(CAMERA_ICON_ID)) return true;

  const svg = buildCameraIconSvg();
  const url =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

  return await new Promise<boolean>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        // 2× DPR: 64 logical → 128 raster, so the icon stays crisp on retina.
        const SIZE = 128;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(false);
          return;
        }
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const data = ctx.getImageData(0, 0, SIZE, SIZE);
        if (!map.hasImage(CAMERA_ICON_ID)) {
          map.addImage(CAMERA_ICON_ID, data, { pixelRatio: 2 });
        }
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** Idempotent: safe to call on every refresh tick. */
export function renderWebcamsOnMap(map: MLMap, videos: YtVideo[]): void {
  // Defer when a style swap is in flight so layer adds aren't lost/thrown.
  whenStyleReady(map, () => renderWebcamsOnMapNow(map, videos));
}

function renderWebcamsOnMapNow(map: MLMap, videos: YtVideo[]): void {
  const data = toFeatureCollection(videos);
  const src = map.getSource(SOURCE_ID);
  if (src && "setData" in src) {
    (src as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(SOURCE_ID, { type: "geojson", data });
  }

  // Kick off icon registration, then add layers. We add layers immediately
  // even if the icon promise hasn't resolved yet because MapLibre will
  // re-resolve missing icons via the styleimagemissing event below.
  void ensureCameraIcon(map);

  if (!map.getLayer(HALO_LAYER_ID)) {
    const beforeId = layerBeforeDynamicOverlays(map);
    map.addLayer(
      {
        id: HALO_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["case", ["get", "isLive"], 16, 10],
          "circle-color": ["case", ["get", "isLive"], HALO_LIVE, HALO_RECENT],
          "circle-opacity": ["case", ["get", "isLive"], 0.35, 0.2],
          "circle-blur": 0.85,
        },
      },
      beforeId,
    );

    map.addLayer(
      {
        id: ICON_LAYER_ID,
        type: "symbol",
        source: SOURCE_ID,
        layout: {
          "icon-image": CAMERA_ICON_ID,
          "icon-size": ["case", ["get", "isLive"], 0.55, 0.45],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-anchor": "center",
        },
        paint: {
          "icon-opacity": ["case", ["get", "isLive"], 1, 0.7],
        },
      },
      beforeId,
    );

    bindInteractions(map);

    // If the icon raster isn't ready when the symbol layer first paints,
    // MapLibre fires `styleimagemissing` once. Re-register on demand.
    map.on("styleimagemissing", (e) => {
      if (e.id === CAMERA_ICON_ID) void ensureCameraIcon(map);
    });
  }
}

export function clearWebcamsFromMap(map: MLMap): void {
  const dispose = handlers.get(map);
  if (dispose) {
    dispose();
    handlers.delete(map);
  }
  closePopup(map);
  if (map.getLayer(ICON_LAYER_ID)) map.removeLayer(ICON_LAYER_ID);
  if (map.getLayer(HALO_LAYER_ID)) map.removeLayer(HALO_LAYER_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

function bindInteractions(map: MLMap): void {
  const setPointer = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const clearPointer = () => {
    map.getCanvas().style.cursor = "";
  };

  const onClick = (
    e: maplibregl.MapMouseEvent & {
      features?: maplibregl.MapGeoJSONFeature[];
    },
  ) => {
    const feat = e.features?.[0];
    if (!feat) return;
    const props = feat.properties as unknown as WebcamFeatureProps;
    const [lon, lat] =
      feat.geometry.type === "Point"
        ? (feat.geometry.coordinates as [number, number])
        : [e.lngLat.lng, e.lngLat.lat];
    openPopup(map, [lon, lat], props);
  };

  for (const layer of WEBCAM_MAP_LAYER_IDS) {
    map.on("mouseenter", layer, setPointer);
    map.on("mouseleave", layer, clearPointer);
    map.on("click", layer, onClick);
  }

  const dispose = () => {
    for (const layer of WEBCAM_MAP_LAYER_IDS) {
      map.off("mouseenter", layer, setPointer);
      map.off("mouseleave", layer, clearPointer);
      map.off("click", layer, onClick);
    }
  };
  handlers.set(map, dispose);
  map.once("remove", dispose);
}

function closePopup(map: MLMap): void {
  const prev = popups.get(map);
  if (prev) {
    prev.remove();
    popups.delete(map);
  }
}

/**
 * We render a plain DOM popup (rather than a React root) because the popup
 * body is a single iframe — no event handlers on our side. Avoiding React
 * here keeps the hot path lean and skips an unnecessary createRoot per click.
 */
function openPopup(
  map: MLMap,
  [lon, lat]: [number, number],
  props: WebcamFeatureProps,
): void {
  closePopup(map);

  const container = document.createElement("div");
  container.className = "aeris-webcam-popup";
  container.style.width = "320px";
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="font-size:10px;color:#7dd3fc;text-transform:uppercase;letter-spacing:0.05em">
          ${props.isLive ? "● LIVE CAM" : "RECENT CAM"}
        </span>
        <span style="font-size:9px;color:#94a3b8">${escapeHtml(
          props.locationLabel,
        )}</span>
      </div>
      <div style="position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:4px;overflow:hidden">
        <iframe
          src="${getEmbedUrl(props.videoId, true, true, { minimalChrome: true })}"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowfullscreen
          style="position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none"
        ></iframe>
        <div style="position:absolute;inset:0;z-index:1" aria-hidden="true"></div>
      </div>
      <div style="font-size:11px;color:#e2e8f0;line-height:1.3;max-height:34px;overflow:hidden">
        ${escapeHtml(props.title)}
      </div>
      <a
        href="https://www.youtube.com/watch?v=${encodeURIComponent(props.videoId)}"
        target="_blank"
        rel="noopener noreferrer"
        style="font-size:9px;color:#7dd3fc;text-decoration:none"
      >Open on YouTube · ${escapeHtml(props.channelName)}</a>
    </div>
  `;

  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    maxWidth: "340px",
    className: "aeris-popup aeris-popup-webcam",
  })
    .setLngLat([lon, lat])
    .setDOMContent(container)
    .addTo(map);

  popup.on("close", () => {
    if (popups.get(map) === popup) popups.delete(map);
  });
  popups.set(map, popup);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
