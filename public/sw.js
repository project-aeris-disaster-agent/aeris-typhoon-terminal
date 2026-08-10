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

/** Read the whole queue inside one short-lived transaction. */
async function readQueue(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Delete a batch of ids inside one fresh transaction. */
async function dropQueued(db, ids) {
  if (!ids.length) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * A queued report older than this is dropped unsent. It matches the 72h
 * operational TTL on the reports feed: a report about conditions three days
 * ago is not actionable, and replaying it wastes an operator's attention
 * during the next event.
 */
const QUEUE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * Flush the offline queue.
 *
 * This used to hold a single transaction open across the whole loop:
 *
 *     const tx = db.transaction(...);            // opened once
 *     const all = await getAll();
 *     for (...) { await fetch(...); store.delete(entry.id); }
 *
 * An IndexedDB transaction auto-commits as soon as the event loop yields, so
 * the first `await fetch` ended it and every `store.delete` afterwards threw
 * TransactionInactiveError — straight into the `catch` labelled "keep queued".
 * The POST had succeeded; the entry was simply never removed. Every later sync
 * replayed the entire backlog, so one report filed offline became a duplicate
 * incident on every reconnect, forever, and the queue never drained.
 *
 * Reads and deletes now each get their own transaction, with the network calls
 * strictly between them.
 */
async function flushQueuedReports() {
  const db = await openQueueDb();
  let all;
  try {
    all = await readQueue(db);
  } catch {
    return;
  }

  const now = Date.now();
  const done = [];

  for (const entry of all) {
    if (typeof entry.ts === "number" && now - entry.ts > QUEUE_MAX_AGE_MS) {
      done.push(entry.id);
      continue;
    }
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry.body),
      });
      // 2xx means stored. A 400 means the server will never accept this body
      // (bad category, coordinates outside PH, spam filter), so retrying it on
      // every reconnect is pointless. Everything else stays queued —
      // especially 401/403, which usually mean the session lapsed while the
      // reporter was offline and will succeed once they sign back in. Losing a
      // citizen's report to an expired cookie is the worse failure.
      if (res.ok || res.status === 400) {
        done.push(entry.id);
      }
    } catch {
      /* offline again — keep queued, try on the next sync */
    }
  }

  await dropQueued(db, done).catch(() => undefined);
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
