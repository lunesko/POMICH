import { fetchJsonWithDeadline } from "./fetchJsonWithDeadline"
import type { LatLngTuple } from "leaflet"
import type { components } from "../api/generated"

import type { Point } from "./constants"

export interface OsrmRouteResult {
  coordinates: LatLngTuple[]
  distanceMeters: number
  durationSeconds: number
}

export async function fetchOsrmRoute(from: Point, to: Point): Promise<OsrmRouteResult | null> {
  const base = import.meta.env.VITE_API_BASE_URL || "/api"
  try {
    const data = await fetchJsonWithDeadline(`${base}/routing/route`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPoint: from, toPoint: to } satisfies components["schemas"]["RouteRequest"]),
    }) as components["schemas"]["RouteResponse"]
    if (data.source !== "osrm" || !data.coordinates?.length || typeof data.distanceMeters !== "number" || typeof data.durationSeconds !== "number") return null
    return { coordinates: data.coordinates, distanceMeters: data.distanceMeters, durationSeconds: data.durationSeconds }
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
    const data = await fetchJsonWithDeadline(url, { headers: { Accept: "application/json" } }) as Array<{ lat?: string; lon?: string }>
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
