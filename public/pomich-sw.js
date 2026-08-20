const TILE_CACHE = "pomich-map-tiles-v3"
const ASSET_CACHE = "pomich-assets-v3"
const TILE_HOST_PATTERN = /(^|\.)tile\.openstreetmap\.org$/

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== TILE_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return

  const url = new URL(event.request.url)

  // Never intercept API — always network.
  if (url.pathname.startsWith("/api/")) return

  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        const response = await fetch(event.request)
        if (response.ok) cache.put(event.request, response.clone())
        return response
      }),
    )
    return
  }

  if (!TILE_HOST_PATTERN.test(url.hostname)) return

  // Cache-first for OSM tiles: network-first caused hundreds of PNG fetches + cancels on pan/zoom.
  event.respondWith(
    caches.open(TILE_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      if (cached) {
        // Soft revalidate in background without blocking the map.
        event.waitUntil(
          fetch(event.request)
            .then((response) => {
              if (response.ok || response.type === "opaque") {
                return cache.put(event.request, response.clone())
              }
              return undefined
            })
            .catch(() => undefined),
        )
        return cached
      }
      try {
        const response = await fetch(event.request)
        if (response.ok || response.type === "opaque") {
          cache.put(event.request, response.clone())
        }
        return response
      } catch (error) {
        throw error
      }
    }),
  )
})
