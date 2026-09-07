import { useEffect } from "react"

import L from "leaflet"
import { useMap } from "react-leaflet"

import { resolveMapTileConfig, type MapTileTheme } from "../../lib/theme"

type CanvasBasemapOptions = L.GridLayerOptions & {
  tileUrl: string
  subdomains: string
}

/**
 * Draw OSM/Carto tiles onto one canvas with 1px overlap.
 * Avoids WebKit hairlines from individual <img> tiles + mix-blend-mode: plus-lighter.
 */
const CanvasBasemapLayer = L.GridLayer.extend({
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
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        // Paint slightly oversized to close subpixel gaps between neighboring canvases.
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

export default function SeamlessTileLayer({ mapTileTheme }: { mapTileTheme: MapTileTheme }) {
  const map = useMap()
  const tile = resolveMapTileConfig({ mapTileTheme })

  useEffect(() => {
    if (!map) return

    // L.GridLayer.extend returns a constructor that accepts options at runtime.
    const LayerCtor = CanvasBasemapLayer as unknown as new (options: CanvasBasemapOptions) => L.GridLayer
    const layer = new LayerCtor({
      maxZoom: 19,
      keepBuffer: 2,
      updateWhenIdle: true,
      updateWhenZooming: false,
      className: "pomich-basemap-tiles",
      attribution: tile.attribution,
      tileUrl: tile.url,
      subdomains: tile.subdomains || "abc",
    })

    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, tile.url, tile.attribution, tile.subdomains])

  return null
}
