const CACHE_NAME = "anonymizer-v4";
const APP_SHELL = [
  "./",
  "index.html",
  "css/main.css",
  "js/main.js",
  "js/worker.js",
  "py/engine.py",
  "py/config.py",
  "py/heuristics.py",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Split by path, not by origin — everything is same-origin now (the
// no-CDN decision, design.md §9.1), but that doesn't mean everything is
// immutable:
// - "vendor/" (Pyodide runtime + wheels): pinned to a specific version by
//   us, never changes for a given deploy — cache-first, cache forever.
//   This is what makes the offline run possible after the first load.
// - everything else (our own HTML/JS/CSS/PY): changes between deploys —
//   network-first with `cache: "no-store"` (bypassing the browser's own
//   HTTP cache, not just Cache Storage), falling back to cache offline.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isVendored = url.origin === self.location.origin && url.pathname.includes("/vendor/");

  if (isVendored) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
