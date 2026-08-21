import type { LatLngTuple, Map as LeafletMap } from "leaflet"

export type GeoPoint = { lat: number; lng: number }

export type SheetSnapForPadding = "collapsed" | "half" | "expanded"

/** Minimum movement before the map recenters on passive geo updates. */
export const MAP_RECENTER_THRESHOLD_M = 40

/** Debounce window for passive geolocation map updates. */
export const MAP_GEO_DEBOUNCE_MS = 400

/** Distances below this use instant panBy; larger moves use a single flyTo. */
export const MAP_FLY_THRESHOLD_M = 200

/** Default sheet heights (% of ride-screen) when CSS vars / DOM measurement are unavailable. */
export const DEFAULT_SHEET_HEIGHTS_VH = {
  peek: 22,
  half: 44,
  expanded: 72,
} as const

/** Extra clearance above the sheet edge so the marker sits in the visible map center. */
export const SHEET_PADDING_SAFETY_PX = 52

/** Persist last GPS across Telegram WebApp reopen (sessionStorage is wiped). */
export const GEO_POSITION_STORAGE_KEY = "pomichLastGeoPosition"
export const GEO_PERMISSION_STORAGE_KEY = "pomichGeoPermission"

/** Prefer cached coords up to 24h so reopen does not force a new OS prompt. */
export const GEO_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Browser may return a cached fix without re-prompting when within this age. */
export const GEO_BROWSER_MAX_AGE_AUTO_MS = 15 * 60 * 1000

const EARTH_RADIUS_M = 6371000

const SHEET_SELECTOR =
  ".pomich-ride-screen--overlay .pomich-sheet-panel--bottom, .pomich-ride-screen .pomich-sheet-panel--bottom"

export type RememberedGeoPermission = "granted" | "denied"

export type GeoRequestMode = "auto" | "explicit"

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

export function readCachedGeoPosition(maxAgeMs = GEO_CACHE_MAX_AGE_MS): GeoPoint | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(GEO_POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { lat?: number; lng?: number; at?: number }
    const lat = Number(parsed.lat)
    const lng = Number(parsed.lng)
    const at = Number(parsed.at)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    // Missing/invalid `at` is treated as expired so corrupt entries cannot stick forever.
    if (!Number.isFinite(at) || (maxAgeMs > 0 && Date.now() - at > maxAgeMs)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

export function writeCachedGeoPosition(point: GeoPoint): void {
  if (typeof window === "undefined") return
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return
  try {
    window.localStorage.setItem(
      GEO_POSITION_STORAGE_KEY,
      JSON.stringify({ lat: point.lat, lng: point.lng, at: Date.now() }),
    )
  } catch {
    // ignore quota / private mode
  }
}

export function readRememberedGeoPermission(): RememberedGeoPermission | null {
  if (typeof window === "undefined") return null
  try {
    const value = window.localStorage.getItem(GEO_PERMISSION_STORAGE_KEY)
    if (value === "granted" || value === "denied") return value
  } catch {
    // ignore
  }
  return null
}

export function writeRememberedGeoPermission(status: RememberedGeoPermission): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(GEO_PERMISSION_STORAGE_KEY, status)
  } catch {
    // ignore
  }
}

/** Query Permissions API when available (often missing inside Telegram WebViews). */
export async function resolveGeoPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  const remembered = readRememberedGeoPermission()
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return remembered ?? "unknown"
  }
  try {
    const result = await navigator.permissions.query({ name: "geolocation" as PermissionName })
    if (result.state === "granted" || result.state === "denied" || result.state === "prompt") {
      if (result.state === "granted" || result.state === "denied") {
        writeRememberedGeoPermission(result.state)
      }
      return result.state
    }
  } catch {
    // Telegram / Safari may reject geolocation permission queries.
  }
  return remembered ?? "unknown"
}

/**
 * True when we can call getCurrentPosition without expecting a fresh OS prompt.
 */
export async function canRequestGeoSilently(): Promise<boolean> {
  const state = await resolveGeoPermission()
  return state === "granted"
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
export type GeoRequestErrorKind = "permission-denied" | "unavailable"

export function classifyGeolocationError(error: GeolocationPositionError): {
  kind: GeoRequestErrorKind
  message: string
} {
  if (error.code === error.PERMISSION_DENIED) {
    return {
      kind: "permission-denied",
      message: "Дозвольте доступ до геолокації в браузері або Telegram, потім натисніть кнопку ще раз.",
    }
  }
  if (error.code === error.TIMEOUT) {
    return {
      kind: "unavailable",
      message: "Не вдалося визначити місцезнаходження вчасно. Натисніть «Оновити» або оберіть точку на карті.",
    }
  }
  return {
    kind: "unavailable",
    message: "Не вдалося визначити місцезнаходження. Спробуйте ще раз або оберіть точку на карті.",
  }
}

function finishGeoSuccess(point: GeoPoint, onSuccess: (point: GeoPoint) => void): void {
  writeCachedGeoPosition(point)
  writeRememberedGeoPermission("granted")
  onSuccess(point)
}

/**
 * Request device location.
 * - `auto`: single low-accuracy call with long maximumAge; reuses localStorage cache so
 *   Telegram WebApp reopen does not re-prompt when a recent fix exists.
 * - `explicit`: user gesture — may try high accuracy then fall back once (not after deny).
 */
export function requestCurrentPosition(
  onSuccess: (point: GeoPoint) => void,
  onError: (message: string, kind?: GeoRequestErrorKind) => void,
  options: { mode?: GeoRequestMode } = {},
): void {
  const mode: GeoRequestMode = options.mode ?? "explicit"
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    onError("Геолокація недоступна у цьому браузері.", "unavailable")
    return
  }

  if (mode === "auto") {
    const remembered = readRememberedGeoPermission()
    const cached = readCachedGeoPosition()

    // Stale local "denied" must not permanently block if the OS already re-allowed.
    if (remembered === "denied") {
      void resolveGeoPermission().then((state) => {
        if (state === "granted") {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              finishGeoSuccess({ lat: position.coords.latitude, lng: position.coords.longitude }, onSuccess)
            },
            (error) => {
              const classified = classifyGeolocationError(error)
              if (classified.kind === "permission-denied") writeRememberedGeoPermission("denied")
              if (cached) onSuccess(cached)
              else onError(classified.message, classified.kind)
            },
            { enableHighAccuracy: false, timeout: 12000, maximumAge: GEO_BROWSER_MAX_AGE_AUTO_MS },
          )
          return
        }
        if (state === "prompt") {
          // Clear sticky deny so a later explicit tap can prompt cleanly.
          try {
            window.localStorage.removeItem(GEO_PERMISSION_STORAGE_KEY)
          } catch {
            // ignore
          }
        }
        if (cached) onSuccess(cached)
        else {
          onError(
            "Доступ до геолокації заборонено. Увімкніть його в налаштуваннях Telegram / браузера, потім натисніть «Оновити».",
            "permission-denied",
          )
        }
      })
      return
    }

    if (cached) {
      // Restore immediately — avoid getCurrentPosition unless permission is known-granted.
      onSuccess(cached)
      void resolveGeoPermission().then((state) => {
        if (state !== "granted") return
        navigator.geolocation.getCurrentPosition(
          (position) => {
            finishGeoSuccess(
              { lat: position.coords.latitude, lng: position.coords.longitude },
              onSuccess,
            )
          },
          () => undefined,
          { enableHighAccuracy: false, timeout: 8000, maximumAge: GEO_BROWSER_MAX_AGE_AUTO_MS },
        )
      })
      return
    }

    // First-time auto request — one attempt only (no high→low double prompt).
    navigator.geolocation.getCurrentPosition(
      (position) => {
        finishGeoSuccess({ lat: position.coords.latitude, lng: position.coords.longitude }, onSuccess)
      },
      (error) => {
        const classified = classifyGeolocationError(error)
        if (classified.kind === "permission-denied") writeRememberedGeoPermission("denied")
        onError(classified.message, classified.kind)
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: GEO_BROWSER_MAX_AGE_AUTO_MS },
    )
    return
  }

  // Explicit user gesture: try high accuracy, then one low-accuracy fallback (skip after deny).
  navigator.geolocation.getCurrentPosition(
    (position) => {
      finishGeoSuccess({ lat: position.coords.latitude, lng: position.coords.longitude }, onSuccess)
    },
    (firstError) => {
      if (firstError.code === firstError.PERMISSION_DENIED) {
        writeRememberedGeoPermission("denied")
        const classified = classifyGeolocationError(firstError)
        onError(classified.message, classified.kind)
        return
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          finishGeoSuccess({ lat: position.coords.latitude, lng: position.coords.longitude }, onSuccess)
        },
        (retryError) => {
          const classified = classifyGeolocationError(retryError)
          if (classified.kind === "permission-denied") writeRememberedGeoPermission("denied")
          const cachedFallback = readCachedGeoPosition()
          if (cachedFallback && classified.kind !== "permission-denied") {
            onSuccess(cachedFallback)
            return
          }
          onError(classified.message, classified.kind)
        },
        { enableHighAccuracy: false, timeout: 20000, maximumAge: GEO_BROWSER_MAX_AGE_AUTO_MS },
      )
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  )
}
