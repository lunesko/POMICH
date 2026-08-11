const TILE_CACHE = "pomich-map-tiles-v1"
const TILE_HOST_PATTERN = /(^|\.)tile\.openstreetmap\.org$/

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (!TILE_HOST_PATTERN.test(url.hostname)) return

  event.respondWith(
    caches.open(TILE_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      try {
        const response = await fetch(event.request)
        if (response.ok || response.type === "opaque") {
          cache.put(event.request, response.clone())
        }
        return response
      } catch {
        if (cached) return cached
        throw new Error("Map tile unavailable offline")
      }
    }),
  )
})
