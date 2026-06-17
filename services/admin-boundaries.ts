import maplibregl, { type Map as MLMap, type MapGeoJSONFeature } from "maplibre-gl";
import { layerBeforeBasemapLabels } from "@/config/map-layers";
import { readDocumentTheme } from "@/lib/theme-storage";
import { escapeHtml } from "@/lib/sanitize";

/**
 * Naga City barangay boundaries overlay.
 *
 * A single small static GeoJSON (`/admin-boundaries/naga-barangays.json`,
 * ~27 features) registered as three MapLibre layers — translucent fill,
 * boundary outline, and name labels — plus a click popup (barangay name +
 * PSGC) and hover highlight. Modelled on `ensureParLayer` in
 * `services/hazard-layers.ts`; the dataset is tiny so it loads eagerly with
 * no manifest / lazy-loading machinery.
 */

const DATA_URL = "/admin-boundaries/naga-barangays.json";
const ATTRIBUTION =
  "Barangay boundaries: GADM via faeldon/philippines-json-maps; PSGC codes: PSA";

export const NAGA_BARANGAY_SOURCE_ID = "src-naga-barangays";
export const NAGA_BARANGAY_FILL_LAYER_ID = "lyr-naga-brgy-fill";
export const NAGA_BARANGAY_LINE_LAYER_ID = "lyr-naga-brgy-line";
export const NAGA_BARANGAY_LABEL_LAYER_ID = "lyr-naga-brgy-label";

const NAGA_BARANGAY_LAYER_IDS = [
  NAGA_BARANGAY_FILL_LAYER_ID,
  NAGA_BARANGAY_LINE_LAYER_ID,
  NAGA_BARANGAY_LABEL_LAYER_ID,
];

const FILL_COLOR = "#38bdf8";
const LINE_COLOR = "#0ea5e9";

// Per-map state: whether interaction handlers are wired, last hovered feature,
// the active popup, and the data fetch promise (so concurrent callers share it).
const handlersBound = new WeakSet<MLMap>();
const hoveredId = new WeakMap<MLMap, number | string>();
const activePopup = new WeakMap<MLMap, maplibregl.Popup>();
// Track the desired visibility per map so it can be restored after a basemap
// style swap (which drops all Aeris-owned layers).
const visibleState = new WeakMap<MLMap, boolean>();
let dataPromise: Promise<GeoJSON.FeatureCollection | null> | null = null;

async function fetchData(): Promise<GeoJSON.FeatureCollection | null> {
  if (!dataPromise) {
    dataPromise = (async () => {
      try {
        const r = await fetch(DATA_URL);
        return r.ok ? ((await r.json()) as GeoJSON.FeatureCollection) : null;
      } catch {
        return null;
      }
    })();
  }
  return dataPromise;
}

function buildPopupContent(props: GeoJSON.GeoJsonProperties): HTMLDivElement {
  const theme = readDocumentTheme();
  const name = String(props?.name ?? "Barangay");
  const psgc = String(props?.psgc ?? "");
  const city = String(props?.city ?? "");

  const card = document.createElement("div");
  card.className = `aeris-facility-card aeris-facility-card--${theme}`;
  card.innerHTML = `
    <div class="aeris-facility-card__header">
      <span class="aeris-facility-card__eyebrow">Barangay</span>
      ${psgc ? `<span class="aeris-facility-card__code">${escapeHtml(psgc)}</span>` : ""}
    </div>
    <h3 class="aeris-facility-card__name">${escapeHtml(name)}</h3>
    ${city ? `<dl class="aeris-facility-card__meta"><div class="aeris-facility-card__row"><dt>City</dt><dd>${escapeHtml(city)}</dd></div></dl>` : ""}
  `;
  return card;
}

function closePopup(map: MLMap): void {
  const popup = activePopup.get(map);
  if (popup) {
    popup.remove();
    activePopup.delete(map);
  }
}

function clearHover(map: MLMap): void {
  const prev = hoveredId.get(map);
  if (prev !== undefined) {
    map.setFeatureState(
      { source: NAGA_BARANGAY_SOURCE_ID, id: prev },
      { hover: false },
    );
    hoveredId.delete(map);
  }
}

function bindInteractions(map: MLMap): void {
  if (handlersBound.has(map)) return;
  handlersBound.add(map);

  map.on("click", NAGA_BARANGAY_FILL_LAYER_ID, (e) => {
    const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
    if (!feature) return;
    closePopup(map);
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      offset: 8,
      maxWidth: "260px",
      className: "aeris-popup aeris-popup-facility",
    })
      .setLngLat(e.lngLat)
      .setDOMContent(buildPopupContent(feature.properties))
      .addTo(map);
    activePopup.set(map, popup);
  });

  map.on("mousemove", NAGA_BARANGAY_FILL_LAYER_ID, (e) => {
    const feature = e.features?.[0] as MapGeoJSONFeature | undefined;
    if (!feature || feature.id === undefined) return;
    map.getCanvas().style.cursor = "pointer";
    if (hoveredId.get(map) === feature.id) return;
    clearHover(map);
    hoveredId.set(map, feature.id);
    map.setFeatureState(
      { source: NAGA_BARANGAY_SOURCE_ID, id: feature.id },
      { hover: true },
    );
  });

  map.on("mouseleave", NAGA_BARANGAY_FILL_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
    clearHover(map);
  });
}

/**
 * Load the Naga barangay GeoJSON and register fill / outline / label layers.
 * Idempotent — safe to call repeatedly and after a basemap style swap.
 */
export async function ensureNagaBarangayLayers(map: MLMap): Promise<void> {
  const data = await fetchData();
  if (!data) return;

  if (!map.getSource(NAGA_BARANGAY_SOURCE_ID)) {
    map.addSource(NAGA_BARANGAY_SOURCE_ID, {
      type: "geojson",
      data,
      generateId: true,
      attribution: ATTRIBUTION,
    });
  }

  const beforeId = layerBeforeBasemapLabels(map);

  if (!map.getLayer(NAGA_BARANGAY_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: NAGA_BARANGAY_FILL_LAYER_ID,
        type: "fill",
        source: NAGA_BARANGAY_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": FILL_COLOR,
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.32,
            0.12,
          ],
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(NAGA_BARANGAY_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: NAGA_BARANGAY_LINE_LAYER_ID,
        type: "line",
        source: NAGA_BARANGAY_SOURCE_ID,
        layout: { visibility: "none", "line-join": "round" },
        paint: {
          "line-color": LINE_COLOR,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.6],
          "line-opacity": 0.85,
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(NAGA_BARANGAY_LABEL_LAYER_ID)) {
    map.addLayer({
      id: NAGA_BARANGAY_LABEL_LAYER_ID,
      type: "symbol",
      source: NAGA_BARANGAY_SOURCE_ID,
      minzoom: 12,
      layout: {
        visibility: "none",
        "text-field": ["get", "name"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 15, 12],
        "text-allow-overlap": false,
        "text-padding": 4,
      },
      paint: {
        "text-color": "#e8eef5",
        "text-halo-color": "#0b1220",
        "text-halo-width": 1.4,
        "text-opacity": 0.95,
      },
    });
  }

  bindInteractions(map);
}

/** Show / hide all Naga barangay layers. */
export function setNagaBarangayVisibility(map: MLMap, visible: boolean): void {
  visibleState.set(map, visible);
  const visibility = visible ? "visible" : "none";
  for (const id of NAGA_BARANGAY_LAYER_IDS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visibility);
    }
  }
  if (!visible) {
    closePopup(map);
    clearHover(map);
  }
}

/**
 * Re-register layers after a basemap style reload (theme swap), restoring the
 * last-known visibility. No-op if the overlay was never enabled on this map.
 */
export async function reattachNagaBarangayLayersAfterStyleChange(
  map: MLMap,
): Promise<void> {
  if (!visibleState.has(map)) return;
  await ensureNagaBarangayLayers(map);
  setNagaBarangayVisibility(map, visibleState.get(map) ?? false);
}
