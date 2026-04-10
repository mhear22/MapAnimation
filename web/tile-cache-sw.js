const TILE_CACHE_NAME = "mapanim-tile-cache-v1";

function withCacheHeader(response, value) {
  const headers = new Headers(response.headers);
  headers.set("X-MapAnim-Client-Cache", value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith("mapanim-tile-cache-") && cacheName !== TILE_CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/tiles/")) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(TILE_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) {
      return withCacheHeader(cached, "hit");
    }

    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return withCacheHeader(response, "miss");
  })());
});
