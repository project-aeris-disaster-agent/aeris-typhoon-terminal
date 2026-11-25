// MapLibre 6 locates its web worker relative to the bundle's `import.meta.url`.
// webpack rewrites that to a file:// URL, so MapLibre finds no worker and the
// map never loads. We serve the (self-contained) worker from our own origin
// instead; `lib/maplibre-worker.ts` points MapLibre at it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const destDir = path.join(root, "public", "vendor", "maplibre");

if (!fs.existsSync(src)) {
  console.warn("[copy-maplibre-worker] maplibre-gl worker not found; skip");
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, "maplibre-gl-worker.mjs"));
console.log(`[copy-maplibre-worker] copied MapLibre worker to ${destDir}`);
