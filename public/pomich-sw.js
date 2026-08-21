const TILE_CACHE = "pomich-map-tiles-v15"
const ASSET_CACHE = "pomich-assets-v15"
const TILE_CACHE_MAX = 350
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

async function putWithTileCap(cache, request, response) {
  await cache.put(request, response.clone())
  const keys = await cache.keys()
  if (keys.length <= TILE_CACHE_MAX) return
  const overflow = keys.length - TILE_CACHE_MAX
  // Cache keys() is insertion-ordered in Chromium — drop oldest (LRU-ish after hit re-put).
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)))
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return

  const url = new URL(event.request.url)

  // Never intercept API — always network.
  if (url.pathname.startsWith("/api/")) return

  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    // Hashed Vite assets: cache-first is safe; miss goes to network once.
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

  // Cache-first with LRU-ish refresh: re-put hits so hot tiles stay newest.
  event.respondWith(
    caches.open(TILE_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      if (cached) {
        event.waitUntil(putWithTileCap(cache, event.request, cached))
        return cached
      }
      const response = await fetch(event.request)
      if (response.ok || response.type === "opaque") {
        await putWithTileCap(cache, event.request, response)
      }
      return response
    }),
  )
})
