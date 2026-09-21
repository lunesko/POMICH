const TILE_CACHE = "pomich-map-tiles-v34"
const SW_GEN = "34"
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
          // Drop every previous generation (including old asset caches) so hashed
          // Vite chunks and opaque tile responses cannot stick after deploy.
          keys.filter((key) => key !== TILE_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

async function putWithTileCap(cache, request, response) {
  // Opaque responses break canvas basemap (CORS) — never cache them.
  if (!response.ok || response.type === "opaque") return
  await cache.put(request, response.clone())
  const keys = await cache.keys()
  if (keys.length <= TILE_CACHE_MAX) return
  const overflow = keys.length - TILE_CACHE_MAX
  await Promise.all(keys.slice(0, overflow).map((key) => caches.delete(key)))
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
    event.respondWith(fetch(event.request, { cache: "no-store" }))
    return
  }

  // Hashed Vite bundles: network-only. Caching them caused Safari to keep deleted
  // chunk URLs after deploy and crash Кабінет / Роль into the error boundary.
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(fetch(event.request))
    return
  }

  if (!TILE_HOST_PATTERN.test(url.hostname)) return

  event.respondWith(
    caches.open(TILE_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request)
      if (cached && cached.ok && cached.type !== "opaque") {
        event.waitUntil(putWithTileCap(cache, event.request, cached))
        return cached
      }
      const response = await fetch(event.request)
      if (response.ok && response.type !== "opaque") {
        await putWithTileCap(cache, event.request, response)
      }
      return response
    }),
  )
})

// Expose generation for debugging / kill-switch coordination.
self.POMICH_SW_GEN = SW_GEN
