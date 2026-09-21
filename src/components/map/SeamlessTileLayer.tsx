import { useEffect } from "react"

import L from "leaflet"
import { useMap } from "react-leaflet"

import { resolveMapTileConfig, type MapTileTheme } from "../../lib/theme"

type CanvasBasemapOptions = L.GridLayerOptions & {
  tileUrl: string
  subdomains: string
}

function createCanvasBasemapLayerClass() {
  return L.GridLayer.extend({
    options: {
      tileUrl: "",
      subdomains: "abc",
      keepBuffer: 2,
      updateWhenIdle: true,
      updateWhenZooming: false,
    },

    createTile(coords: L.Coords, done: (error?: Error, tile?: HTMLElement) => void) {
      const canvas = document.createElement("canvas")
      canvas.width = 256
      canvas.height = 256
      canvas.className = "pomich-basemap-tiles pomich-basemap-tiles--canvas"
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        setTimeout(() => done(new Error("canvas_unavailable"), canvas), 0)
        return canvas
      }

      const img = new Image()
      // Do not set crossOrigin — anonymous CORS failures blank the whole basemap
      // on iOS ("Карта пропала"). We never read pixels, so a tainted canvas is fine.
      img.onload = () => {
        try {
          ctx.drawImage(img, -1, -1, 258, 258)
        } catch {
          ctx.fillStyle = "#e8e0d8"
          ctx.fillRect(0, 0, 256, 256)
        }
        done(undefined, canvas)
      }
      img.onerror = () => {
        ctx.fillStyle = "#e8e0d8"
        ctx.fillRect(0, 0, 256, 256)
        done(undefined, canvas)
      }

      const opts = this.options as CanvasBasemapOptions
      let url = opts.tileUrl
        .replace("{z}", String(coords.z))
        .replace("{x}", String(coords.x))
        .replace("{y}", String(coords.y))
        .replace("{r}", L.Browser.retina ? "@2x" : "")
      if (url.includes("{s}")) {
        const subs = opts.subdomains || "abc"
        const s = subs[Math.abs(coords.x + coords.y) % subs.length]
        url = url.replace("{s}", s)
      }
      img.src = url
      return canvas
    },
  })
}

/**
 * Draw OSM/Carto tiles onto canvas with 1px overlap.
 * Avoids WebKit hairlines from <img> tiles + mix-blend-mode: plus-lighter.
 * Falls back to L.tileLayer when GridLayer is unavailable (tests / odd builds).
 */
export default function SeamlessTileLayer({ mapTileTheme }: { mapTileTheme: MapTileTheme }) {
  const map = useMap()
  const tile = resolveMapTileConfig({ mapTileTheme })

  useEffect(() => {
    if (!map || typeof (map as { addLayer?: unknown }).addLayer !== "function") return

    let layer: L.Layer
    let added = false

    const addImgTileLayer = () => {
      const usesSubdomains = tile.url.includes("{s}")
      return L.tileLayer(tile.url, {
        maxZoom: 19,
        keepBuffer: 2,
        updateWhenIdle: true,
        updateWhenZooming: false,
        className: "pomich-basemap-tiles",
        attribution: tile.attribution,
        ...(usesSubdomains && tile.subdomains ? { subdomains: tile.subdomains } : {}),
        detectRetina: tile.url.includes("{r}"),
      })
    }

    try {
      // Safari / TG WebView: prefer img tiles — canvas+CORS blanks the map.
      const preferImg =
        typeof L.Browser !== "undefined" && (L.Browser.safari || L.Browser.mobile || L.Browser.android)
      if (!preferImg && typeof L.GridLayer?.extend === "function") {
        const LayerCtor = createCanvasBasemapLayerClass() as unknown as new (
          options: CanvasBasemapOptions,
        ) => L.GridLayer
        layer = new LayerCtor({
          maxZoom: 19,
          keepBuffer: 2,
          updateWhenIdle: true,
          updateWhenZooming: false,
          className: "pomich-basemap-tiles",
          attribution: tile.attribution,
          tileUrl: tile.url,
          subdomains: tile.subdomains || "abc",
        })
      } else {
        layer = addImgTileLayer()
      }

      layer.addTo(map)
      added = true
      try {
        map.invalidateSize(false)
      } catch {
        // ignore
      }
    } catch (error) {
      console.warn("[POMICH] SeamlessTileLayer skipped", error)
      try {
        layer = addImgTileLayer()
        layer.addTo(map)
        added = true
      } catch (fallbackError) {
        console.warn("[POMICH] SeamlessTileLayer fallback failed", fallbackError)
        return
      }
    }

    return () => {
      if (!added) return
      try {
        map.removeLayer(layer)
      } catch {
        // Map may already be torn down during role/cabinet transitions.
      }
    }
  }, [map, tile.url, tile.attribution, tile.subdomains])

  return null
}
