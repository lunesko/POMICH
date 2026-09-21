const TILE_CACHE = "pomich-map-tiles-v32"
const ASSET_CACHE = "pomich-assets-v32"
const TILE_CACHE_MAX = 350
const TILE_HOST_PATTERN = /(^|\.)(tile\.openstreetmap\.org|basemaps\.cartocdn\.com)$/

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
            // Drop previous SW generations so hashed Vite chunks cannot stick after deploy.
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
  await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)))
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return

  const url = new URL(event.request.url)

  // Never intercept API — always network.
  if (url.pathname.startsWith("/api/")) return

  // HTML / SW entry — always network so clients pick up new Vite hashes after deploy.
  if (
    url.origin === self.location.origin &&
    (url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname === "/pomich-sw.js" ||
      url.pathname.endsWith(".html"))
  ) {
    event.respondWith(fetch(event.request))
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    // Network-first for hashed assets: avoids serving a 404 shell from an old cache key
    // when a new deploy renamed the chunk.
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE)
        try {
          const response = await fetch(event.request)
          if (response.ok) cache.put(event.request, response.clone())
          return response
        } catch (networkError) {
          const cached = await cache.match(event.request)
          if (cached) return cached
          throw networkError
        }
      })(),
    )
    return
  }

  if (!TILE_HOST_PATTERN.test(url.hostname)) return

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
