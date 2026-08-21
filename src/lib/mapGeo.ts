import type { LatLngTuple, Map as LeafletMap } from "leaflet"

import { requestTelegramLocation } from "../telegram"

export type GeoPoint = { lat: number; lng: number }

export type SheetSnapForPadding = "collapsed" | "half" | "expanded"

/** Minimum movement before the map recenters on passive geo updates. */
export const MAP_RECENTER_THRESHOLD_M = 40

/** Debounce window for passive geolocation map updates. */
export const MAP_GEO_DEBOUNCE_MS = 400

/** Distances below this use instant panBy; larger moves use a single flyTo. */
export const MAP_FLY_THRESHOLD_M = 200

/** Speed (m/s) below this counts as standing still — map zooms in. ~3 km/h. */
export const MOTION_STATIONARY_MPS = 0.85

/** Slow crawl / lights / approaching a turn. ~18 km/h. */
export const MOTION_SLOW_MPS = 5

/** Typical city driving. ~50 km/h. */
export const MOTION_CITY_MPS = 14

/** Faster than city traffic. ~80 km/h. */
export const MOTION_FAST_MPS = 22

/** Leaflet zoom when stopped (street-level detail). */
export const MOTION_ZOOM_STATIONARY = 17

/** Zoom when crawling / at lights. */
export const MOTION_ZOOM_SLOW = 16

/** Zoom at city speeds — slight pull-back for context. */
export const MOTION_ZOOM_CITY = 15

/** Zoom when moving faster than city traffic. */
export const MOTION_ZOOM_FAST = 14

/** Extra zoom-in when decelerating or heading into a turn (clamped). */
export const MOTION_ZOOM_TURN_BOOST = 0.75

/** Ignore zoom tweaks smaller than this to avoid flicker. */
export const MOTION_ZOOM_HYSTERESIS = 0.35

/** Heading delta (degrees) that counts as entering a turn. */
export const MOTION_TURN_HEADING_DEG = 28

/** Look-ahead along a route polyline when detecting turns (meters). */
export const MOTION_TURN_LOOKAHEAD_M = 80

/** Min speed drop ratio vs recent peak to treat as decelerating (lights / turn). */
export const MOTION_DECEL_RATIO = 0.55

/** Default sheet heights (% of ride-screen) when CSS vars / DOM measurement are unavailable. */
export const DEFAULT_SHEET_HEIGHTS_VH = {
  peek: 26,
  half: 52,
  expanded: 74,
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

/** Normalize GPS speed (m/s). Negative / NaN → null (device did not report speed). */
export function normalizeGpsSpeedMps(speed: number | null | undefined): number | null {
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0) return null
  return speed
}

/** Estimate ground speed from two fixes when `coords.speed` is missing. */
export function estimateSpeedMps(from: GeoPoint, to: GeoPoint, elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 200) return null
  const meters = distanceMeters(from, to)
  if (!Number.isFinite(meters)) return null
  return meters / (elapsedMs / 1000)
}

/** Initial bearing from A→B in degrees [0, 360). */
export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const toDegrees = (value: number) => (value * 180) / Math.PI
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const deltaLng = toRadians(to.lng - from.lng)
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return (toDegrees(Math.atan2(y, x)) + 360) % 360
}

export function headingDeltaDegrees(fromHeading: number, toHeading: number): number {
  const raw = Math.abs(toHeading - fromHeading) % 360
  return raw > 180 ? 360 - raw : raw
}

/**
 * True when the upcoming route segment bends sharply (street turn / exit).
 * `route` is ordered along travel; `fromIndex` is the closest point behind the user.
 */
export function isRouteTurnAhead(
  route: GeoPoint[],
  fromIndex: number,
  lookAheadM = MOTION_TURN_LOOKAHEAD_M,
  turnDeg = MOTION_TURN_HEADING_DEG,
): boolean {
  if (route.length < 3 || fromIndex < 0 || fromIndex >= route.length - 2) return false
  let traveled = 0
  let maxBend = 0
  for (let i = fromIndex; i < route.length - 2; i += 1) {
    const a = route[i]!
    const b = route[i + 1]!
    const c = route[i + 2]!
    const bend = headingDeltaDegrees(bearingDegrees(a, b), bearingDegrees(b, c))
    if (bend > maxBend) maxBend = bend
    traveled += distanceMeters(a, b)
    if (traveled > lookAheadM) break
  }
  return maxBend >= turnDeg
}

/** Nearest route vertex index to `point` (linear scan — routes are short). */
export function nearestRouteIndex(route: GeoPoint[], point: GeoPoint): number {
  if (route.length === 0) return -1
  let bestIndex = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < route.length; i += 1) {
    const dist = distanceMeters(point, route[i]!)
    if (dist < bestDist) {
      bestDist = dist
      bestIndex = i
    }
  }
  return bestIndex
}

export type MotionZoomInput = {
  /** Ground speed in m/s (GPS or estimated). */
  speedMps: number | null | undefined
  /** Recent peak speed used to detect braking for lights / turns. */
  recentPeakSpeedMps?: number | null
  /** Absolute heading change since the last sample (degrees). */
  headingDeltaDeg?: number | null
  /** Sharp bend on the active route within look-ahead. */
  routeTurnAhead?: boolean
  /** Last applied motion zoom — used for hysteresis. */
  previousZoom?: number | null
}

/**
 * Map speed → Leaflet zoom.
 * Standing still → close in; city/fast → pull back a little; slow / braking / turns → zoom in.
 */
export function resolveMotionZoom({
  speedMps,
  recentPeakSpeedMps,
  headingDeltaDeg,
  routeTurnAhead = false,
  previousZoom,
}: MotionZoomInput): number {
  const speed = typeof speedMps === "number" && Number.isFinite(speedMps) && speedMps >= 0 ? speedMps : 0

  let zoom: number
  if (speed < MOTION_STATIONARY_MPS) zoom = MOTION_ZOOM_STATIONARY
  else if (speed < MOTION_SLOW_MPS) zoom = MOTION_ZOOM_SLOW
  else if (speed < MOTION_CITY_MPS) zoom = MOTION_ZOOM_CITY
  else if (speed < MOTION_FAST_MPS) zoom = (MOTION_ZOOM_CITY + MOTION_ZOOM_FAST) / 2
  else zoom = MOTION_ZOOM_FAST

  const peak =
    typeof recentPeakSpeedMps === "number" && Number.isFinite(recentPeakSpeedMps) ? recentPeakSpeedMps : null
  const decelerating =
    peak != null && peak >= MOTION_SLOW_MPS && speed <= peak * MOTION_DECEL_RATIO && speed < MOTION_CITY_MPS

  const turningByHeading =
    typeof headingDeltaDeg === "number" &&
    Number.isFinite(headingDeltaDeg) &&
    headingDeltaDeg >= MOTION_TURN_HEADING_DEG &&
    speed >= MOTION_STATIONARY_MPS

  if (decelerating || turningByHeading || routeTurnAhead) {
    zoom = Math.min(MOTION_ZOOM_STATIONARY, zoom + MOTION_ZOOM_TURN_BOOST)
  }

  if (typeof previousZoom === "number" && Number.isFinite(previousZoom)) {
    if (Math.abs(zoom - previousZoom) < MOTION_ZOOM_HYSTERESIS) return previousZoom
  }

  return zoom
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
    zoom,
    paddingBottom = 0,
  }: {
    animateLarge?: boolean
    minZoom?: number
    /** When set, use this zoom instead of max(current, minZoom). */
    zoom?: number
    /** Pixels covered by bottom sheet — target is offset so the point stays above it. */
    paddingBottom?: number
  } = {},
): void {
  const nextZoom =
    typeof zoom === "number" && Number.isFinite(zoom) ? zoom : Math.max(map.getZoom(), minZoom)
  const target = offsetLatLngForBottomPadding(map, point, paddingBottom, nextZoom)

  if (animateLarge) {
    map.flyTo(target, nextZoom, { duration: 0.55 })
    return
  }

  const mapCenter = map.getCenter()
  const meters = distanceMeters({ lat: mapCenter.lat, lng: mapCenter.lng }, { lat: target[0], lng: target[1] })
  const zoomDelta = Math.abs(map.getZoom() - nextZoom)

  if (meters >= MAP_FLY_THRESHOLD_M || zoomDelta >= MOTION_ZOOM_HYSTERESIS) {
    map.flyTo(target, nextZoom, { duration: 0.45 })
    return
  }

  if (zoomDelta > 0.05 && typeof map.setZoom === "function") {
    map.setZoom(nextZoom, { animate: false })
  }

  const projectedTarget = map.project(target, nextZoom)
  const current = map.project(mapCenter, nextZoom)
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

    // No cache: only auto-call getCurrentPosition when permission is already granted,
    // or inside Telegram Mini App (WebView prompts work without a website gesture).
    // Public Safari/Chrome often suppress the OS prompt without a tap — leave UI idle for «Оновити».
    void resolveGeoPermission().then((state) => {
      const inTelegramMiniApp = Boolean(
        typeof window !== "undefined" && String(window.Telegram?.WebApp?.initData || "").trim(),
      )
      if (state === "granted" || inTelegramMiniApp) {
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
      if (state === "denied") {
        writeRememberedGeoPermission("denied")
        onError(
          "Доступ до геолокації заборонено. Увімкніть його в налаштуваннях браузера, потім натисніть «Оновити».",
          "permission-denied",
        )
        return
      }
      onError(
        "Натисніть «Оновити», щоб дозволити геолокацію в браузері.",
        "unavailable",
      )
    })
    return
  }

  // Explicit user gesture: Telegram LocationManager first, then browser GPS.
  try {
    window.localStorage.removeItem(GEO_PERMISSION_STORAGE_KEY)
  } catch {
    // ignore
  }

  const requestBrowserExplicit = () => {
    // Prefer low-accuracy first — more reliable permission prompt in Telegram/iOS WebViews.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        finishGeoSuccess({ lat: position.coords.latitude, lng: position.coords.longitude }, onSuccess)
      },
      (firstError) => {
        if (firstError.code === firstError.PERMISSION_DENIED) {
          writeRememberedGeoPermission("denied")
          onError(
            "Доступ до геолокації заборонено. Натисніть «Налаштування гео», дозвольте доступ, потім «Оновити» ще раз.",
            "permission-denied",
          )
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
            onError(
              classified.kind === "permission-denied"
                ? "Доступ до геолокації заборонено. Натисніть «Налаштування гео», дозвольте доступ, потім «Оновити» ще раз."
                : classified.message,
              classified.kind,
            )
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        )
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 },
    )
  }

  const usedTelegram = requestTelegramLocation(
    (point) => finishGeoSuccess(point, onSuccess),
    () => {
      writeRememberedGeoPermission("denied")
      onError(
        "Доступ до геолокації заборонено. Натисніть «Налаштування гео», дозвольте доступ у Telegram, потім «Оновити».",
        "permission-denied",
      )
    },
    () => requestBrowserExplicit(),
  )
  if (!usedTelegram) requestBrowserExplicit()
}
