import type { LatLngTuple, Map as LeafletMap } from "leaflet"

export type GeoPoint = { lat: number; lng: number }

export type SheetSnapForPadding = "collapsed" | "half" | "expanded"

/** Minimum movement before the map recenters on passive geo updates. */
export const MAP_RECENTER_THRESHOLD_M = 40

/** Debounce window for passive geolocation map updates. */
export const MAP_GEO_DEBOUNCE_MS = 400

/** Distances below this use instant panBy; larger moves use a single flyTo. */
export const MAP_FLY_THRESHOLD_M = 200

/** Default sheet heights in vh when CSS vars / DOM measurement are unavailable. */
export const DEFAULT_SHEET_HEIGHTS_VH = {
  peek: 18,
  half: 52,
  expanded: 88,
} as const

/** Extra clearance above the sheet edge so the marker sits in the visible map center. */
export const SHEET_PADDING_SAFETY_PX = 52

const EARTH_RADIUS_M = 6371000

const SHEET_SELECTOR =
  ".pomich-ride-screen--overlay .pomich-sheet-panel--bottom, .pomich-ride-screen .pomich-sheet-panel--bottom"

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

/** Read the live bottom-sheet height in px (most accurate for Telegram overlay). */
export function measureBottomSheetHeightPx(): number {
  if (typeof document === "undefined") return 0
  const sheet = document.querySelector(SHEET_SELECTOR) as HTMLElement | null
  if (!sheet) return 0
  const height = sheet.getBoundingClientRect().height
  return Number.isFinite(height) && height > 0 ? height : 0
}

/**
 * Bottom padding (px) so locate/flyTo places the user in the visible map above the sheet.
 * Prefers live DOM sheet height; falls back to snap × map height. Always pads when a sheet
 * is present — including collapsed peek — so the point never sits under the panel.
 */
export function resolveSheetBottomPaddingPx(
  sheetSnap: SheetSnapForPadding | undefined,
  mapHeightPx: number,
  heightsVh: { peek: number; half: number; expanded: number } = DEFAULT_SHEET_HEIGHTS_VH,
  options: { overlayMode?: boolean; measuredSheetPx?: number } = {},
): number {
  if (mapHeightPx <= 0) return 0

  const measured =
    typeof options.measuredSheetPx === "number" && options.measuredSheetPx > 0
      ? options.measuredSheetPx
      : measureBottomSheetHeightPx()

  if (measured > 0) {
    return Math.min(measured + SHEET_PADDING_SAFETY_PX, mapHeightPx * 0.9)
  }

  if (!sheetSnap && !options.overlayMode) return 0

  const snap: SheetSnapForPadding = sheetSnap ?? "half"
  const vh =
    snap === "expanded" ? heightsVh.expanded : snap === "collapsed" ? heightsVh.peek : heightsVh.half

  return Math.min((vh / 100) * mapHeightPx + SHEET_PADDING_SAFETY_PX, mapHeightPx * 0.9)
}

/**
 * Shift fly/pan target south so `point` lands in the vertical center of the unobscured viewport
 * (map height minus bottom sheet), not the geometric center of the full map container.
 */
export function offsetLatLngForBottomPadding(
  map: LeafletMap,
  point: LatLngTuple,
  paddingBottomPx: number,
  zoom: number,
): LatLngTuple {
  if (paddingBottomPx <= 0) return point
  const projected = map.project(point, zoom)
  // Leaflet Y grows downward: push target south so the real point sits higher on screen.
  const shifted = map.unproject([projected.x, projected.y + paddingBottomPx / 2], zoom)
  return [shifted.lat, shifted.lng]
}

export function moveMapToPoint(
  map: LeafletMap,
  point: LatLngTuple,
  {
    animateLarge = true,
    minZoom = 14,
    paddingBottom = 0,
  }: {
    animateLarge?: boolean
    minZoom?: number
    /** Pixels covered by bottom sheet — target is offset so the point stays above it. */
    paddingBottom?: number
  } = {},
): void {
  const zoom = Math.max(map.getZoom(), minZoom)
  const target = offsetLatLngForBottomPadding(map, point, paddingBottom, zoom)

  if (animateLarge) {
    map.flyTo(target, zoom, { duration: 0.55 })
    return
  }

  const mapCenter = map.getCenter()
  const meters = distanceMeters({ lat: mapCenter.lat, lng: mapCenter.lng }, { lat: target[0], lng: target[1] })

  if (meters >= MAP_FLY_THRESHOLD_M) {
    map.flyTo(target, zoom, { duration: 0.55 })
    return
  }

  const projectedTarget = map.project(target, zoom)
  const current = map.project(mapCenter, zoom)
  map.panBy([projectedTarget.x - current.x, projectedTarget.y - current.y], { animate: false })
}

/** Shared geolocation options with a low-accuracy fallback for Telegram WebApp. */
export function requestCurrentPosition(
  onSuccess: (point: GeoPoint) => void,
  onError: (message: string) => void,
): void {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    onError("Геолокація недоступна у цьому браузері.")
    return
  }

  const failMessage = (error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) {
      return "Дозвольте доступ до геолокації в браузері або Telegram, потім натисніть кнопку ще раз."
    }
    return "Не вдалося визначити місцезнаходження. Спробуйте ще раз."
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      onSuccess({ lat: position.coords.latitude, lng: position.coords.longitude })
    },
    (error) => {
      // Telegram / rough GPS often fails high-accuracy; retry once without it.
      navigator.geolocation.getCurrentPosition(
        (position) => {
          onSuccess({ lat: position.coords.latitude, lng: position.coords.longitude })
        },
        (retryError) => {
          onError(failMessage(retryError))
        },
        { enableHighAccuracy: false, timeout: 16000, maximumAge: 60000 },
      )
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
  )
}
