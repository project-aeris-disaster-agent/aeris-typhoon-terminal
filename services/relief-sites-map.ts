"use client";

import maplibregl, { Map as MLMap, Popup } from "maplibre-gl";
import { layerBeforeDynamicOverlays, whenStyleReady } from "@/config/map-layers";
import { escapeHtml } from "@/lib/sanitize";
import type { ReliefSiteView } from "@/lib/relief-ops";

/**
 * Relief pickup sites on the map: a dot coloured by how much of the site's
 * relief has been released, with the share served beside it. Colours are the
 * FLOOD CONTROL tokens (bagyogame src/ui/theme/tokens.ts): warm while few
 * households are served, blue mid-release, green when nearly done, muted
 * when ReQuest gave no counts.
 */

const SOURCE_ID = "relief-sites";
const HALO_LAYER_ID = "relief-sites-halo";
const DOT_LAYER_ID = "relief-sites-dot";
const LABEL_LAYER_ID = "relief-sites-label";

export const RELIEF_MAP_LAYER_IDS = [HALO_LAYER_ID, DOT_LAYER_ID, LABEL_LAYER_ID] as const;

const WARM = "#f08a1c";
const BLUE = "#1f6fd1";
const GREEN = "#149a63";
const MUTED = "#6b7f96";
const INK = "#0f2a47";

type SiteProps = {
  id: string;
  operation: string;
  barangay: string;
  pickupPoint: string;
  /** -1 when ReQuest gave no counts. */
  served: number;
  label: string;
  issued: number;
  claimed: number;
  url: string;
  window: string;
};

export type ReliefMapSite = ReliefSiteView & { operationName: string };

const popups = new WeakMap<MLMap, Popup>();
const handlers = new WeakMap<MLMap, () => void>();

export function formatPickupWindow(start: string | null, end: string | null): string {
  if (!start) return "";
  const fmt = (iso: string, withDay: boolean) =>
    new Date(iso).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}),
      hour: "numeric",
      minute: "2-digit",
    });
  return end ? `${fmt(start, true)} – ${fmt(end, false)}` : fmt(start, true);
}

function toFeatureCollection(
  sites: ReliefMapSite[],
): GeoJSON.FeatureCollection<GeoJSON.Point, SiteProps> {
  const features: GeoJSON.Feature<GeoJSON.Point, SiteProps>[] = [];
  for (const s of sites) {
    if (s.lat == null || s.lon == null) continue;
    const served =
      s.counts && s.counts.issued > 0 ? Math.min(1, s.counts.claimed / s.counts.issued) : -1;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        operation: s.operationName,
        barangay: s.barangay,
        pickupPoint: s.pickupPoint ?? "",
        served,
        label: served < 0 ? "" : `${Math.round(served * 100)}%`,
        issued: s.counts?.issued ?? 0,
        claimed: s.counts?.claimed ?? 0,
        url: s.requestEventUrl,
        window: formatPickupWindow(s.pickupStart, s.pickupEnd),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

const SERVED_COLOR: maplibregl.ExpressionSpecification = [
  "case",
  ["<", ["get", "served"], 0],
  MUTED,
  ["interpolate", ["linear"], ["get", "served"], 0, WARM, 0.5, BLUE, 0.9, GREEN],
];

/** Idempotent: safe to call on every poll. */
export function renderReliefSitesOnMap(map: MLMap, sites: ReliefMapSite[]): void {
  whenStyleReady(map, () => renderNow(map, sites));
}

function renderNow(map: MLMap, sites: ReliefMapSite[]): void {
  const data = toFeatureCollection(sites);
  const src = map.getSource(SOURCE_ID);
  if (src && "setData" in src) {
    (src as maplibregl.GeoJSONSource).setData(data);
  } else {
    map.addSource(SOURCE_ID, { type: "geojson", data });
  }
  if (map.getLayer(DOT_LAYER_ID)) return;

  const beforeId = layerBeforeDynamicOverlays(map);
  map.addLayer(
    {
      id: HALO_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 15,
        "circle-color": SERVED_COLOR,
        "circle-opacity": 0.22,
        "circle-blur": 0.4,
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: DOT_LAYER_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 7,
        "circle-color": SERVED_COLOR,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: LABEL_LAYER_ID,
      type: "symbol",
      source: SOURCE_ID,
      minzoom: 9,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [1.1, 0],
        "text-anchor": "left",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": INK,
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.6,
      },
    },
    beforeId,
  );
  bindInteractions(map);
}

export function clearReliefSitesFromMap(map: MLMap): void {
  handlers.get(map)?.();
  handlers.delete(map);
  closePopup(map);
  for (const id of [...RELIEF_MAP_LAYER_IDS].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

/** Fly to a site and open its card (used by the panel's "Show on map"). */
export function focusReliefSite(map: MLMap, site: ReliefMapSite): void {
  if (site.lat == null || site.lon == null) return;
  map.flyTo({ center: [site.lon, site.lat], zoom: Math.max(map.getZoom(), 14), duration: 900 });
  const [feature] = toFeatureCollection([site]).features;
  if (feature) openPopup(map, [site.lon, site.lat], feature.properties);
}

function bindInteractions(map: MLMap): void {
  const setPointer = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const clearPointer = () => {
    map.getCanvas().style.cursor = "";
  };
  const onClick = (e: maplibregl.MapLayerMouseEvent) => {
    const feat = e.features?.[0];
    if (!feat || feat.geometry.type !== "Point") return;
    openPopup(
      map,
      feat.geometry.coordinates as [number, number],
      feat.properties as unknown as SiteProps,
    );
  };
  map.on("mouseenter", DOT_LAYER_ID, setPointer);
  map.on("mouseleave", DOT_LAYER_ID, clearPointer);
  map.on("click", DOT_LAYER_ID, onClick);
  const dispose = () => {
    map.off("mouseenter", DOT_LAYER_ID, setPointer);
    map.off("mouseleave", DOT_LAYER_ID, clearPointer);
    map.off("click", DOT_LAYER_ID, onClick);
  };
  handlers.set(map, dispose);
  map.once("remove", dispose);
}

function closePopup(map: MLMap): void {
  popups.get(map)?.remove();
  popups.delete(map);
}

function openPopup(map: MLMap, lngLat: [number, number], p: SiteProps): void {
  closePopup(map);
  const served = Number(p.served);
  const pct = served < 0 ? null : Math.round(served * 100);
  const safeUrl = /^https:\/\//.test(p.url) ? escapeHtml(p.url) : null;

  // Bagyo day card: white, ink text, spaced-caps kicker, chunky progress bar.
  const el = document.createElement("div");
  el.style.cssText =
    // `.aeris-popup` leaves the popup shell transparent; the card draws itself
    // (same as .aeris-facility-card).
    "box-sizing:border-box;width:250px;display:flex;flex-direction:column;gap:6px;padding:12px 14px 13px;border-radius:14px;border:1px solid rgb(var(--aeris-border));background:rgb(var(--aeris-surface));box-shadow:var(--aeris-pop-shadow);font-family:var(--font-nunito),'Segoe UI',system-ui,sans-serif;color:rgb(var(--aeris-text))";
  el.innerHTML = `
    <div style="font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgb(var(--aeris-kicker-ink))">Relief pickup · ${escapeHtml(String(p.operation))}</div>
    <div style="font-size:15px;font-weight:800;line-height:1.2">Brgy. ${escapeHtml(String(p.barangay))}</div>
    ${p.pickupPoint ? `<div style="font-size:12px;color:rgb(var(--aeris-ink2))">${escapeHtml(String(p.pickupPoint))}</div>` : ""}
    ${p.window ? `<div style="font-size:12px;color:rgb(var(--aeris-muted))">${escapeHtml(String(p.window))}</div>` : ""}
    ${
      // No counts (link-only mode, or ReQuest didn't answer): the panel says
      // why; the card just leads to the event page.
      pct == null
        ? ""
        : `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800"><span>${Number(p.claimed).toLocaleString()} of ${Number(p.issued).toLocaleString()} households</span><span>${pct}%</span></div>
           <div style="height:6px;border-radius:999px;background:rgb(var(--aeris-text) / .09);overflow:hidden"><div style="height:100%;width:${pct}%;border-radius:999px;background:linear-gradient(90deg,#43a8ff,#1f6fd1)"></div></div>`
    }
    ${safeUrl ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="aeris-btn-cta" style="margin-top:4px;gap:4px;padding:7px 10px;font-size:11px;text-decoration:none">Open in ReQuest ↗</a>` : ""}
  `;

  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    offset: 14,
    className: "aeris-popup",
    maxWidth: "280px",
  })
    .setLngLat(lngLat)
    .setDOMContent(el)
    .addTo(map);
  popups.set(map, popup);
  popup.on("close", () => {
    if (popups.get(map) === popup) popups.delete(map);
  });
}
