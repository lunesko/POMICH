import type { LatLngTuple, Map as LeafletMap } from "leaflet"

export type GeoPoint = { lat: number; lng: number }

/** Minimum movement before the map recenters on passive geo updates. */
export const MAP_RECENTER_THRESHOLD_M = 40

/** Debounce window for passive geolocation map updates. */
export const MAP_GEO_DEBOUNCE_MS = 400

/** Distances below this use instant panBy; larger moves use a single flyTo. */
export const MAP_FLY_THRESHOLD_M = 200

const EARTH_RADIUS_M = 6371000

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const deltaLat = toRadians(to.lat - from.lat)
  const deltaLng = toRadians(to.lng - from.lng)
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

export function toLatLngTuple(point: GeoPoint): LatLngTuple {
  return [point.lat, point.lng]
}

export function shouldRecenterMap(from: GeoPoint, to: GeoPoint, thresholdM = MAP_RECENTER_THRESHOLD_M): boolean {
  return distanceMeters(from, to) >= thresholdM
}

export function moveMapToPoint(
  map: LeafletMap,
  point: LatLngTuple,
  {
    animateLarge = true,
    minZoom = 14,
  }: {
    animateLarge?: boolean
    minZoom?: number
  } = {},
): void {
  const zoom = Math.max(map.getZoom(), minZoom)

  if (animateLarge) {
    map.flyTo(point, zoom, { duration: 0.55 })
    return
  }

  const mapCenter = map.getCenter()
  const meters = distanceMeters({ lat: mapCenter.lat, lng: mapCenter.lng }, { lat: point[0], lng: point[1] })

  if (meters >= MAP_FLY_THRESHOLD_M) {
    map.flyTo(point, zoom, { duration: 0.55 })
    return
  }

  const target = map.project(point, zoom)
  const current = map.project(mapCenter, zoom)
  map.panBy([target.x - current.x, target.y - current.y], { animate: false })
}
