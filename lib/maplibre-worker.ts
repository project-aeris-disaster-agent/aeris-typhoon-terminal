import { getVersion, setWorkerUrl } from "maplibre-gl";

/**
 * Point MapLibre at the worker copied into `public/` by
 * `scripts/copy-maplibre-worker.mjs`. MapLibre 6 derives the worker URL from
 * its own `import.meta.url`, which webpack turns into a file:// URL, so without
 * this the map never loads. The version query busts caches on upgrades.
 *
 * Call before creating the first map; later calls are harmless.
 */
export function configureMaplibreWorker(): void {
  setWorkerUrl(
    `/vendor/maplibre/maplibre-gl-worker.mjs?v=${encodeURIComponent(getVersion())}`,
  );
}
