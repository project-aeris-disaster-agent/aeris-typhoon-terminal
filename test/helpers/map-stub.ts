import type { Map as MLMap } from "maplibre-gl";

type Bounds = { west: number; south: number; east: number; north: number };

const DEFAULT_BOUNDS: Bounds = {
  west: 118,
  south: 8,
  east: 128,
  north: 18,
};

/** Minimal MapLibre stub for overlay / wind canvas tests (not a mock of code under test). */
export function createMapStub(
  bounds: Bounds = DEFAULT_BOUNDS,
  size = { width: 480, height: 360 },
) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", {
    value: size.width,
    configurable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: size.height,
    configurable: true,
  });

  const canvas = document.createElement("canvas");
  const style: Record<string, string> = {};
  Object.defineProperty(canvas, "style", {
    get: () => style,
    configurable: true,
  });

  const layers = new Set<string>();
  const sources = new Map<string, { setData?: (d: unknown) => void }>();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let pixelRatio = 2;

  const map = {
    getContainer: () => container,
    getCanvas: () => canvas,
    getBounds: () => ({
      getWest: () => bounds.west,
      getEast: () => bounds.east,
      getSouth: () => bounds.south,
      getNorth: () => bounds.north,
    }),
    project: (coord: [number, number]) => ({
      x: ((coord[0] - bounds.west) / (bounds.east - bounds.west)) * size.width,
      y: ((bounds.north - coord[1]) / (bounds.north - bounds.south)) * size.height,
    }),
    getZoom: () => 9,
    getStyle: () => ({}),
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: { data?: unknown }) => {
      sources.set(id, {
        setData: (data: unknown) => {
          spec.data = data;
        },
      });
    },
    addLayer: (layer: { id: string }) => {
      layers.add(layer.id);
    },
    removeLayer: (id: string) => {
      layers.delete(id);
    },
    removeSource: (id: string) => {
      sources.delete(id);
    },
    setPaintProperty: jest.fn(),
    setLayoutProperty: jest.fn(),
    setFilter: jest.fn(),
    setPixelRatio: jest.fn((n: number) => {
      pixelRatio = n;
    }),
    getPixelRatio: () => pixelRatio,
    resize: jest.fn(),
    triggerRepaint: jest.fn(),
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    once: (event: string, handler: (...args: unknown[]) => void) => {
      const wrap = (...args: unknown[]) => {
        map.off(event, wrap);
        handler(...args);
      };
      map.on(event, wrap);
    },
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((h) => h(...args));
    },
  };

  return map as unknown as MLMap & {
    emit: (event: string, ...args: unknown[]) => void;
    getPixelRatio: () => number;
  };
}

export function createWindFieldPayload() {
  const w = 4;
  const h = 3;
  const n = w * h;
  return {
    width: w,
    height: h,
    west: 120,
    south: 10,
    east: 124,
    north: 13,
    u: Array.from({ length: n }, () => 3),
    v: Array.from({ length: n }, () => 1),
    p: Array.from({ length: n }, () => 1010),
    generatedAt: "2026-06-01T00:00:00Z",
  };
}
