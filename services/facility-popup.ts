import maplibregl, { type Map as MLMap, type Popup } from "maplibre-gl";
import {
  buildFacilityPopupElement,
  facilityFeatureKey,
  type FacilityDisplayProps,
} from "@/lib/facility-display";

export type FacilityPopupTheme = "light" | "dark";

type FacilityPopupEntry = {
  popup: Popup;
  featureKey: string;
  coordinates: [number, number];
  properties: FacilityDisplayProps;
};

const activePopups = new WeakMap<MLMap, FacilityPopupEntry>();

function mountPopupContent(
  entry: FacilityPopupEntry,
  theme: FacilityPopupTheme,
): void {
  const el = buildFacilityPopupElement(
    entry.properties,
    entry.coordinates,
    theme,
  );
  entry.popup.setDOMContent(el);
}

export function closeFacilityPopup(map: MLMap): void {
  const prev = activePopups.get(map);
  if (!prev) return;
  prev.popup.remove();
  activePopups.delete(map);
}

export function openFacilityPopup(
  map: MLMap,
  coordinates: [number, number],
  properties: FacilityDisplayProps | null | undefined,
  theme: FacilityPopupTheme,
): void {
  const key = facilityFeatureKey(coordinates, properties);
  const prev = activePopups.get(map);
  if (prev?.featureKey === key) {
    closeFacilityPopup(map);
    return;
  }

  closeFacilityPopup(map);

  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 22,
    maxWidth: "280px",
    className: `aeris-popup aeris-popup-facility aeris-popup-facility--${theme}`,
  })
    .setLngLat(coordinates)
    .addTo(map);

  const entry: FacilityPopupEntry = {
    popup,
    featureKey: key,
    coordinates,
    properties: properties ?? {},
  };
  mountPopupContent(entry, theme);
  activePopups.set(map, entry);
}

export function refreshFacilityPopupTheme(
  map: MLMap,
  theme: FacilityPopupTheme,
): void {
  const entry = activePopups.get(map);
  if (!entry) return;
  const el = entry.popup.getElement();
  if (el) {
    el.classList.remove("aeris-popup-facility--light", "aeris-popup-facility--dark");
    el.classList.add(`aeris-popup-facility--${theme}`);
  }
  mountPopupContent(entry, theme);
}
