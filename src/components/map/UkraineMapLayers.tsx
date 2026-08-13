import { useEffect, useRef, useState } from "react"

import L from "leaflet"
import { GeoJSON, useMap } from "react-leaflet"

import {
  OCCUPIED_TERRITORIES_GEOJSON_URL,
  UKRAINE_BOUNDS,
  UKRAINE_MAP_FIT_MAX_ZOOM,
  UKRAINE_MAP_FIT_MAX_ZOOM_MOBILE,
  UKRAINE_MAP_STYLES,
} from "../../lib/ukraineMapMask"

type GeoFeature = {
  type: "Feature"
  properties?: Record<string, unknown>
  geometry: {
    type: string
    coordinates: unknown
  }
}

type GeoFeatureCollection = {
  type: "FeatureCollection"
  features: GeoFeature[]
}

const UKRAINE_PANE = "pomich-ukraine-pane"

interface UkraineMapLayersProps {
  /** Subtle occupied-territory tint only — no border stroke or outside dim. */
  enabled?: boolean
  /** Fit Ukraine bounds on first load (directory / hero maps). */
  fitCountry?: boolean
}

async function fetchGeoJson(url: string): Promise<GeoFeature | GeoFeatureCollection | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as GeoFeature | GeoFeatureCollection
  } catch {
    return null
  }
}

function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false
    if (typeof window.matchMedia !== "function") return document.documentElement.classList.contains("tg-compact")
    return window.matchMedia("(max-width: 768px)").matches || document.documentElement.classList.contains("tg-compact")
  })

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const mq = window.matchMedia("(max-width: 768px)")
    const sync = () => {
      setCompact(mq.matches || document.documentElement.classList.contains("tg-compact"))
    }
    sync()
    mq.addEventListener("change", sync)
    return () => mq.removeEventListener("change", sync)
  }, [])

  return compact
}

function UkraineMapPane() {
  const map = useMap()

  useEffect(() => {
    if (!map || typeof map.getPane !== "function") return
    if (!map.getPane(UKRAINE_PANE)) {
      if (typeof map.createPane === "function") {
        map.createPane(UKRAINE_PANE)
      }
      const pane = map.getPane(UKRAINE_PANE)
      if (pane) pane.style.zIndex = "350"
    }
  }, [map])

  return null
}

function UkraineMapFitCountry() {
  const map = useMap()
  const compact = useCompactViewport()
  const fittedRef = useRef(false)

  useEffect(() => {
    if (fittedRef.current) return
    if (!map || typeof map.fitBounds !== "function") return

    const [south, west, north, east] = UKRAINE_BOUNDS
    const bounds = L.latLngBounds([south, west], [north, east])
    const padding: [number, number] = compact ? [16, 16] : [24, 24]
    const maxZoom = compact ? UKRAINE_MAP_FIT_MAX_ZOOM_MOBILE : UKRAINE_MAP_FIT_MAX_ZOOM

    const id = window.requestAnimationFrame(() => {
      map.fitBounds(bounds, { padding, maxZoom })
      if (typeof map.invalidateSize === "function") map.invalidateSize(false)
      fittedRef.current = true
    })

    return () => window.cancelAnimationFrame(id)
  }, [compact, map])

  return null
}

export function UkraineMapLayers({ enabled = false, fitCountry = false }: UkraineMapLayersProps) {
  const [occupied, setOccupied] = useState<GeoFeatureCollection | GeoFeature | null>(null)
  const compact = useCompactViewport()

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetchGeoJson(OCCUPIED_TERRITORIES_GEOJSON_URL).then((occupiedData) => {
      if (cancelled) return
      if (occupiedData) setOccupied(occupiedData)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const geoSmoothFactor = compact ? 2.5 : 1.5

  if (!enabled) return fitCountry ? <UkraineMapFitCountry /> : null

  return (
    <>
      <UkraineMapPane />
      {fitCountry ? <UkraineMapFitCountry /> : null}
      {occupied ? (
        <GeoJSON
          {...({
            key: "occupied-territories",
            data: occupied,
            pane: UKRAINE_PANE,
            interactive: false,
            smoothFactor: geoSmoothFactor,
            style: UKRAINE_MAP_STYLES.occupied,
          } as any)}
        />
      ) : null}
    </>
  )
}

export default UkraineMapLayers
