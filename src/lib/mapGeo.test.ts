import { describe, expect, it, vi, afterEach } from "vitest"

import {
  classifyGeolocationError,
  distanceMeters,
  estimateSpeedMps,
  GEO_CACHE_MAX_AGE_MS,
  GEO_PERMISSION_STORAGE_KEY,
  GEO_POSITION_STORAGE_KEY,
  headingDeltaDegrees,
  isRouteTurnAhead,
  MAP_FLY_THRESHOLD_M,
  MAP_RECENTER_THRESHOLD_M,
  measureBottomSheetHeightPx,
  MOTION_ZOOM_CITY,
  MOTION_ZOOM_FAST,
  MOTION_ZOOM_SLOW,
  MOTION_ZOOM_STATIONARY,
  nearestRouteIndex,
  normalizeGpsSpeedMps,
  readCachedGeoPosition,
  readRememberedGeoPermission,
  requestCurrentPosition,
  resolveMotionZoom,
  resolveSheetBottomPaddingPx,
  shouldRecenterMap,
  SHEET_PADDING_SAFETY_PX,
  writeCachedGeoPosition,
  writeRememberedGeoPermission,
} from "./mapGeo"

describe("mapGeo", () => {
  const uzhgorodCenter = { lat: 48.6208, lng: 22.2879 }

  afterEach(() => {
    document.body.innerHTML = ""
    window.localStorage.removeItem(GEO_POSITION_STORAGE_KEY)
    window.localStorage.removeItem(GEO_PERMISSION_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  it("classifies permission denied separately from timeout", () => {
    const denied = classifyGeolocationError({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as GeolocationPositionError)
    const timedOut = classifyGeolocationError({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as GeolocationPositionError)
    expect(denied.kind).toBe("permission-denied")
    expect(timedOut.kind).toBe("unavailable")
    expect(timedOut.message).toMatch(/вчасно|Оновити/i)
  })

  it("computes distance in meters", () => {
    const nearby = { lat: 48.621, lng: 22.288 }
    expect(distanceMeters(uzhgorodCenter, nearby)).toBeGreaterThan(0)
    expect(distanceMeters(uzhgorodCenter, nearby)).toBeLessThan(MAP_RECENTER_THRESHOLD_M)
  })

  it("respects recenter threshold", () => {
    const tinyMove = { lat: 48.62081, lng: 22.28791 }
    const largeMove = { lat: 48.625, lng: 22.295 }

    expect(shouldRecenterMap(uzhgorodCenter, tinyMove)).toBe(false)
    expect(shouldRecenterMap(uzhgorodCenter, largeMove)).toBe(true)
  })

  it("defines fly threshold above recenter threshold", () => {
    expect(MAP_FLY_THRESHOLD_M).toBeGreaterThan(MAP_RECENTER_THRESHOLD_M)
  })

  it("normalizes GPS speed and estimates from point deltas", () => {
    expect(normalizeGpsSpeedMps(null)).toBeNull()
    expect(normalizeGpsSpeedMps(-1)).toBeNull()
    expect(normalizeGpsSpeedMps(0)).toBe(0)
    expect(normalizeGpsSpeedMps(12.5)).toBe(12.5)

    const far = { lat: 48.625, lng: 22.295 }
    const estimated = estimateSpeedMps(uzhgorodCenter, far, 1000)
    expect(estimated).toBeGreaterThan(5)
    expect(estimateSpeedMps(uzhgorodCenter, far, 50)).toBeNull()
  })

  it("zooms in when stationary and pulls back at city or faster speeds", () => {
    expect(resolveMotionZoom({ speedMps: 0 })).toBe(MOTION_ZOOM_STATIONARY)
    expect(resolveMotionZoom({ speedMps: 3 })).toBe(MOTION_ZOOM_SLOW)
    expect(resolveMotionZoom({ speedMps: 12 })).toBe(MOTION_ZOOM_CITY)
    expect(resolveMotionZoom({ speedMps: 25 })).toBe(MOTION_ZOOM_FAST)
  })

  it("zooms in when decelerating for lights or heading into a turn", () => {
    const cruising = resolveMotionZoom({ speedMps: 12 })
    const braking = resolveMotionZoom({
      speedMps: 4,
      recentPeakSpeedMps: 14,
    })
    expect(braking).toBeGreaterThan(cruising)

    const turning = resolveMotionZoom({
      speedMps: 10,
      headingDeltaDeg: 40,
    })
    expect(turning).toBeGreaterThan(cruising)

    const routeTurn = resolveMotionZoom({
      speedMps: 11,
      routeTurnAhead: true,
    })
    expect(routeTurn).toBeGreaterThan(cruising)
  })

  it("keeps zoom stable within hysteresis", () => {
    const first = resolveMotionZoom({ speedMps: 12 })
    const second = resolveMotionZoom({ speedMps: 12.2, previousZoom: first })
    expect(second).toBe(first)
  })

  it("detects sharp bends on a route look-ahead", () => {
    const route = [
      { lat: 48.62, lng: 22.28 },
      { lat: 48.6203, lng: 22.28 },
      { lat: 48.6206, lng: 22.28 },
      { lat: 48.6206, lng: 22.2804 },
      { lat: 48.6206, lng: 22.2808 },
    ]
    expect(headingDeltaDegrees(0, 90)).toBe(90)
    expect(nearestRouteIndex(route, { lat: 48.6203, lng: 22.28 })).toBe(1)
    expect(isRouteTurnAhead(route, 0)).toBe(true)
    expect(isRouteTurnAhead(route.slice(0, 3), 0)).toBe(false)
  })

  it("pads for half and expanded sheets including safety margin", () => {
    const half = resolveSheetBottomPaddingPx("half", 800)
    const expanded = resolveSheetBottomPaddingPx("expanded", 800)
    expect(half).toBeCloseTo(0.52 * 800 + SHEET_PADDING_SAFETY_PX, 5)
    expect(expanded).toBeGreaterThan(half)
  })

  it("pads collapsed peek so the point stays above the sheet", () => {
    const peek = resolveSheetBottomPaddingPx("collapsed", 800)
    expect(peek).toBeCloseTo(0.26 * 800 + SHEET_PADDING_SAFETY_PX, 5)
  })

  it("assumes half sheet in overlay mode when snap is missing", () => {
    const pad = resolveSheetBottomPaddingPx(undefined, 800, undefined, { overlayMode: true })
    expect(pad).toBeCloseTo(0.52 * 800 + SHEET_PADDING_SAFETY_PX, 5)
  })

  it("prefers live DOM sheet height over vh estimates", () => {
    const sheet = document.createElement("div")
    sheet.className = "pomich-sheet-panel--bottom"
    const screen = document.createElement("div")
    screen.className = "pomich-ride-screen--overlay"
    screen.appendChild(sheet)
    document.body.appendChild(screen)
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({
      height: 420,
      width: 360,
      top: 200,
      left: 0,
      bottom: 620,
      right: 360,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    })

    expect(measureBottomSheetHeightPx()).toBe(420)
    expect(resolveSheetBottomPaddingPx("half", 800)).toBe(420 + SHEET_PADDING_SAFETY_PX)
  })

  it("persists and restores cached geo without prompting again", () => {
    writeCachedGeoPosition(uzhgorodCenter)
    writeRememberedGeoPermission("granted")
    expect(readCachedGeoPosition()).toEqual(uzhgorodCenter)
    expect(readRememberedGeoPermission()).toBe("granted")
    window.localStorage.setItem(
      GEO_POSITION_STORAGE_KEY,
      JSON.stringify({ ...uzhgorodCenter, at: Date.now() - 10_000 }),
    )
    expect(readCachedGeoPosition(1_000)).toBeNull()
    expect(GEO_CACHE_MAX_AGE_MS).toBeGreaterThan(60_000)
  })

  it("auto mode reuses cache and does not call getCurrentPosition when permission unknown", () => {
    writeCachedGeoPosition(uzhgorodCenter)
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: undefined,
    })

    const onSuccess = vi.fn()
    requestCurrentPosition(onSuccess, vi.fn(), { mode: "auto" })
    expect(onSuccess).toHaveBeenCalledWith(uzhgorodCenter)
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it("auto mode skips OS prompt when denial was remembered", async () => {
    writeRememberedGeoPermission("denied")
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: {
        query: vi.fn(async () => ({ state: "denied" })),
      },
    })
    const onError = vi.fn()
    requestCurrentPosition(vi.fn(), onError, { mode: "auto" })
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/заборонено|Оновити/i), "permission-denied")
  })

  it("auto mode re-queries OS when sticky deny is cleared to granted", async () => {
    writeRememberedGeoPermission("denied")
    writeCachedGeoPosition(uzhgorodCenter)
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 48.63, longitude: 22.28, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
    })
    const onSuccess = vi.fn()
    requestCurrentPosition(onSuccess, vi.fn(), { mode: "auto" })
    await vi.waitFor(() => expect(getCurrentPosition).toHaveBeenCalled())
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ lat: 48.63, lng: 22.28 }))
  })

  it("auto mode applies fresh GPS to onSuccess after cache restore", async () => {
    writeCachedGeoPosition(uzhgorodCenter)
    writeRememberedGeoPermission("granted")
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 48.64, longitude: 22.3, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: {
        query: vi.fn(async () => ({ state: "granted" })),
      },
    })
    const onSuccess = vi.fn()
    requestCurrentPosition(onSuccess, vi.fn(), { mode: "auto" })
    expect(onSuccess).toHaveBeenCalledWith(uzhgorodCenter)
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ lat: 48.64, lng: 22.3 }))
  })

  it("explicit mode clears sticky deny and requests a fresh browser fix", () => {
    writeRememberedGeoPermission("denied")
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 48.65, longitude: 22.31, accuracy: 12, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: undefined,
    })
    const onSuccess = vi.fn()
    requestCurrentPosition(onSuccess, vi.fn(), { mode: "explicit" })
    expect(getCurrentPosition).toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledWith({ lat: 48.65, lng: 22.31 })
    expect(readRememberedGeoPermission()).toBe("granted")
  })

  it("explicit mode prefers Telegram LocationManager when available", () => {
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: undefined,
    })
    vi.stubGlobal("Telegram", {
      WebApp: {
        initData: "query_id=1&user=%7B%7D",
        LocationManager: {
          isInited: true,
          getLocation: (callback: (location: { latitude: number; longitude: number } | null) => void) => {
            callback({ latitude: 48.61, longitude: 22.27 })
          },
        },
      },
    })
    const onSuccess = vi.fn()
    requestCurrentPosition(onSuccess, vi.fn(), { mode: "explicit" })
    expect(onSuccess).toHaveBeenCalledWith({ lat: 48.61, lng: 22.27 })
    expect(getCurrentPosition).not.toHaveBeenCalled()
  })

  it("explicit mode skips Telegram LocationManager without Mini App initData", () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 48.66, longitude: 22.32, accuracy: 12, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
        timestamp: Date.now(),
      } as GeolocationPosition)
    })
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: undefined,
    })
    vi.stubGlobal("Telegram", {
      WebApp: {
        initData: "",
        LocationManager: {
          isInited: true,
          getLocation: vi.fn(),
        },
      },
    })
    const onSuccess = vi.fn()
    requestCurrentPosition(onSuccess, vi.fn(), { mode: "explicit" })
    expect(getCurrentPosition).toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledWith({ lat: 48.66, lng: 22.32 })
  })

  it("auto mode asks for an explicit tap on the public website when permission is unknown", async () => {
    const getCurrentPosition = vi.fn()
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
      permissions: undefined,
    })
    vi.stubGlobal("Telegram", { WebApp: { initData: "" } })
    const onError = vi.fn()
    requestCurrentPosition(vi.fn(), onError, { mode: "auto" })
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Оновити/i), "unavailable")
  })
})
