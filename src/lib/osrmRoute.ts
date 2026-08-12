import type { LatLngTuple } from "leaflet"

import type { Point } from "./constants"

export interface OsrmRouteResult {
  coordinates: LatLngTuple[]
  distanceMeters: number
  durationSeconds: number
}

export async function fetchOsrmRoute(from: Point, to: Point): Promise<OsrmRouteResult | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const data = (await response.json()) as {
      routes?: Array<{
        distance?: number
        duration?: number
        geometry?: { coordinates?: Array<[number, number]> }
      }>
    }
    const route = data.routes?.[0]
    const coordinates = route?.geometry?.coordinates
    if (!route || !coordinates?.length || typeof route.distance !== "number" || typeof route.duration !== "number") {
      return null
    }
    return {
      coordinates: coordinates.map(([lng, lat]) => [lat, lng] as LatLngTuple),
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    }
  } catch {
    return null
  }
}

export function formatRouteDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} км`
  return `${Math.round(meters)} м`
}

export function formatRouteDuration(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    return remainder > 0 ? `${hours} год ${remainder} хв` : `${hours} год`
  }
  return `${minutes} хв`
}

export async function forwardGeocodeAddress(query: string): Promise<Point | null> {
  const trimmed = query.trim()
  if (!trimmed) return null
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&limit=1&accept-language=uk`
    const response = await fetch(url, { headers: { Accept: "application/json" } })
    if (!response.ok) return null
    const data = (await response.json()) as Array<{ lat?: string; lon?: string }>
    const hit = data[0]
    if (!hit?.lat || !hit?.lon) return null
    const lat = Number(hit.lat)
    const lng = Number(hit.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}
