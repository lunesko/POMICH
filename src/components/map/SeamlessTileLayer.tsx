import { useEffect } from "react"

import L from "leaflet"
import { useMap } from "react-leaflet"

import { resolveMapTileConfig, type MapTileTheme } from "../../lib/theme"

/**
 * Interactive basemap with iOS / Telegram WebView seam hardening.
 * Leaflet's default CSS uses mix-blend-mode: plus-lighter (Chrome seam hack)
 * which paints bright white tile edges on WebKit — overridden in index.css.
 */
export default function SeamlessTileLayer({ mapTileTheme }: { mapTileTheme: MapTileTheme }) {
  const map = useMap()
  const tile = resolveMapTileConfig({ mapTileTheme })

  useEffect(() => {
    if (!map) return

    const usesSubdomains = tile.url.includes("{s}")
    const layer = L.tileLayer(tile.url, {
      maxZoom: 19,
      keepBuffer: 2,
      updateWhenIdle: true,
      updateWhenZooming: false,
      className: "pomich-basemap-tiles",
      attribution: tile.attribution,
      ...(usesSubdomains && tile.subdomains ? { subdomains: tile.subdomains } : {}),
      // Detect retina so HiDPI phones request denser tiles when URL supports {r}
      detectRetina: tile.url.includes("{r}"),
    })

    layer.addTo(map)

    // Force opaque tiles as soon as each image loads (no fade blink).
    layer.on("tileload", (event: L.TileEvent) => {
      const el = event.tile as HTMLElement
      if (el) {
        el.style.opacity = "1"
        el.style.visibility = "inherit"
      }
    })

    return () => {
      map.removeLayer(layer)
    }
  }, [map, tile.url, tile.attribution, tile.subdomains])

  return null
}
