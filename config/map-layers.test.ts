import type { Map as MLMap } from "maplibre-gl";
import { CARTO_VECTOR_LABEL_ANCHOR_LAYER_ID } from "@/config/basemap-style";
import {
  AERIS_OVERLAY_TOP_LAYER_ID,
  BASEMAP_LABEL_LAYER_ID,
  layerBeforeBasemapLabels,
  layerBeforeDynamicOverlays,
  resolveBasemapLabelAnchorLayer,
} from "@/config/map-layers";

describe("layerBeforeBasemapLabels", () => {
  it("returns osm-top-labels when the raster label layer exists", () => {
    const map = {
      getLayer: (id: string) => (id === BASEMAP_LABEL_LAYER_ID ? {} : undefined),
      getStyle: () => ({ layers: [] }),
    } as unknown as MLMap;
    expect(layerBeforeBasemapLabels(map)).toBe(BASEMAP_LABEL_LAYER_ID);
  });

  it("returns waterway_label when using CARTO vector basemap", () => {
    const map = {
      getLayer: (id: string) =>
        id === CARTO_VECTOR_LABEL_ANCHOR_LAYER_ID ? {} : undefined,
      getStyle: () => ({ layers: [] }),
    } as unknown as MLMap;
    expect(resolveBasemapLabelAnchorLayer(map)).toBe(
      CARTO_VECTOR_LABEL_ANCHOR_LAYER_ID,
    );
  });

  it("returns undefined when no label anchor is registered yet", () => {
    const map = {
      getLayer: () => undefined,
      getStyle: () => ({ layers: [] }),
    } as unknown as MLMap;
    expect(layerBeforeBasemapLabels(map)).toBeUndefined();
  });
});

describe("layerBeforeDynamicOverlays", () => {
  it("returns aeris-overlay-top when the top slot exists", () => {
    const map = {
      getLayer: (id: string) => (id === AERIS_OVERLAY_TOP_LAYER_ID ? {} : undefined),
    } as unknown as MLMap;
    expect(layerBeforeDynamicOverlays(map)).toBe(AERIS_OVERLAY_TOP_LAYER_ID);
  });
});
