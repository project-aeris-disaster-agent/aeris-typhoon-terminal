/**
 * AERIS Typhoon Terminal — Service Worker
 *
 * Strategies:
 *  - App shell: cache-first with network revalidation
 *  - Hazard layers & DEM: cache-first, long TTL
 *  - Basemap tiles (OSM / CARTO): stale-while-revalidate
 *  - **Live weather tiles (GIBS / RainViewer): always network**
 *      The browser HTTP cache plus per-frame URLs already give us the right
 *      caching behavior; layering SWR on top here was masking stale frames
 *      when revalidation silently failed (the operator-visible "wrong
 *      satellite imagery" symptom).
 *  - API responses (alerts, forecast, jtwc): network-first with offline fallback
 *  - Scene packs: network-first with cached asset fallback
 *  - Reports POST: queued in IndexedDB when offline, flushed on reconnect via
 *    background sync
 */

const SW_VERSION = "aeris-v3";
const CACHE_SHELL = `${SW_VERSION}-shell`;
const CACHE_HAZARDS = `${SW_VERSION}-hazards`;
const CACHE_SCENE = `${SW_VERSION}-scene`;
const CACHE_TILES = `${SW_VERSION}-tiles`;
const CACHE_API = `${SW_VERSION}-api`;
const QUEUE_DB = "aeris-queue";
const QUEUE_STORE = "reports";
/** Hosts that may be cached via stale-while-revalidate (basemap-only). */
const TILE_HOST_RE = /tile\.openstreetmap|basemaps\.cartocdn\.com/;
/**
 * Hosts whose responses must **always** hit the network. Keeping live-weather
 * imagery here prevents the SW from serving an out-of-date PNG while a
 * background revalidation silently fails or stalls.
 */
const LIVE_WEATHER_HOST_RE = /gibs\.earthdata\.nasa\.gov|rainviewer\.com/;

const SHELL_ASSETS = ["/", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((c) => c.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => !n.startsWith(SW_VERSION))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "POST" && request.url.includes("/api/reports")) {
    event.respondWith(handleReportPost(request.clone()));
    return;
  }
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.pathname.startsWith("/hazards/") || url.pathname.startsWith("/dem/")) {
    event.respondWith(cacheFirst(CACHE_HAZARDS, request));
    return;
  }
  if (url.pathname.startsWith("/osm-context/")) {
    event.respondWith(networkFirstAsset(CACHE_SCENE, request));
    return;
  }
  if (LIVE_WEATHER_HOST_RE.test(request.url)) {
    /**
     * Bypass the SW entirely for live-weather tile hosts. The browser will
     * still apply its own HTTP cache via response headers, which is the
     * correct behavior for time-keyed tile URLs.
     */
    return;
  }
  if (
    TILE_HOST_RE.test(request.url) ||
    url.pathname.match(/\.(png|jpg|webp|pbf)$/)
  ) {
    event.respondWith(staleWhileRevalidate(CACHE_TILES, request));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstJson(CACHE_API, request));
    return;
  }
  event.respondWith(staleWhileRevalidate(CACHE_SHELL, request));
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    return cached ?? new Response("offline", { status: 503 });
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached ?? fetchPromise;
}

async function networkFirstAsset(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("offline", { status: 503 });
  }
}

async function networkFirstJson(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true, data: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}

async function handleReportPost(request) {
  try {
    const res = await fetch(request);
    return res;
  } catch {
    const body = await request.json().catch(() => null);
    if (body) await enqueueReport(body);
    try {
      await self.registration.sync.register("aeris-report-sync");
    } catch {
      /* browsers without background sync: flush next time user is online */
    }
    return new Response(
      JSON.stringify({
        queued: true,
        report: { ...body, id: `pending-${Date.now()}`, createdAt: new Date().toISOString(), confirmations: 0 },
      }),
      {
        status: 202,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueueReport(body) {
  const db = await openQueueDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).add({ body, ts: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function flushQueuedReports() {
  const db = await openQueueDb();
  const tx = db.transaction(QUEUE_STORE, "readwrite");
  const store = tx.objectStore(QUEUE_STORE);
  const all = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  for (const entry of all) {
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry.body),
      });
      if (res.ok) store.delete(entry.id);
    } catch {
      /* keep queued, try again later */
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag === "aeris-report-sync") {
    event.waitUntil(flushQueuedReports());
  }
});

self.addEventListener("message", (event) => {
  if (event.data === "flush-queue") {
    event.waitUntil(flushQueuedReports());
  }
});
