import type { CSSProperties, ReactNode, WheelEvent } from "react"
import { Children, isValidElement, useEffect, useMemo, useState } from "react"

import type { MapRequestPin, ProviderAvailability } from "../../api/client"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { useMobileSheetSnap } from "../../hooks/useMobileSheetSnap"
import type { Point } from "../../lib/constants"
import type { DirectoryScopeMode } from "../../lib/directoryScope"
import { getTelegramContext } from "../../telegram"
import LazyRouteMap from "../map/LazyRouteMap"
import { useSuppressMapAtmosphere } from "./PomichMapShell"
import type { MapTileTheme } from "../../lib/theme"

function isolatePanelWheel(event: WheelEvent<HTMLElement>) {
  event.stopPropagation()
}

export function filterSheetChildren(children: ReactNode, mobileSheet: boolean, snap: "collapsed" | "half" | "expanded") {
  return Children.toArray(children).filter((child) => {
    if (!isValidElement<{ "data-sheet-peek"?: boolean; "data-sheet-full"?: boolean }>(child)) return true
    if (child.props["data-sheet-peek"] !== undefined) {
      return mobileSheet && snap === "collapsed"
    }
    if (child.props["data-sheet-full"] !== undefined) {
      return !mobileSheet || snap !== "collapsed"
    }
    return true
  })
}

interface RideScreenProps {
  pickup: Point
  destination?: Point
  providers?: ProviderAvailability[]
  providerPosition?: Point
  requestPins?: MapRequestPin[]
  mapSubtitle?: string
  showAllProviders?: boolean
  showDirectoryProviders?: boolean
  userLocation?: Point
  onUserLocationChange?: (point: Point) => void
  onPick?: (point: Point) => void
  onAcceptRequest?: (pin: MapRequestPin) => void
  onContactRequest?: (pin: MapRequestPin) => void
  onRequestPinSelect?: (pin: MapRequestPin) => void
  onProviderSelect?: (provider: ProviderAvailability) => void
  expandedSheet?: boolean
  mapFocus?: boolean
  defaultSnap?: "collapsed" | "half" | "expanded"
  onRetryGeo?: () => void
  geoLoading?: boolean
  geoError?: string
  recenterTrigger?: number
  directoryScope?: DirectoryScopeMode
  onDirectoryScopeChange?: (scope: DirectoryScopeMode) => void
  directoryScopeCity?: string
  directoryScopeGeoLoading?: boolean
  directoryScopeGeoError?: string
  onDirectoryScopeGeoRetry?: () => void
  directoryScopeRecenterTrigger?: number
  directoryScopeCityCenter?: Point
  showUkraineMask?: boolean
  mapZoom?: number
  enableMotionZoom?: boolean
  motionSpeedMps?: number | null
  motionHeadingDeg?: number | null
  children: ReactNode
}

export function RideScreen({
  pickup,
  destination,
  providers,
  providerPosition,
  requestPins,
  mapSubtitle,
  showAllProviders = false,
  showDirectoryProviders = false,
  userLocation,
  onUserLocationChange,
  onPick,
  onAcceptRequest,
  onContactRequest,
  onRequestPinSelect,
  onProviderSelect,
  expandedSheet = false,
  mapFocus = false,
  defaultSnap = "half",
  onRetryGeo,
  geoLoading = false,
  geoError,
  recenterTrigger = 0,
  directoryScope,
  onDirectoryScopeChange,
  directoryScopeCity,
  directoryScopeGeoLoading,
  directoryScopeGeoError,
  onDirectoryScopeGeoRetry,
  directoryScopeRecenterTrigger,
  directoryScopeCityCenter,
  showUkraineMask = false,
  mapZoom,
  enableMotionZoom,
  motionSpeedMps,
  motionHeadingDeg,
  children,
}: RideScreenProps) {
  /* Interactive ride map owns the viewport — don't stack decorative shell map underneath. */
  useSuppressMapAtmosphere()
  const mapTileTheme: MapTileTheme = "light"
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTablet = useMediaQuery(mediaQueries.tablet)
  const isDesktop = useMediaQuery(mediaQueries.desktop)
  const isTelegram = useMemo(() => getTelegramContext().isTelegram, [])
  const compactChrome = useMemo(() => {
    if (typeof document === "undefined") return isTelegram || isMobile
    const root = document.documentElement
    return (
      isTelegram ||
      isMobile ||
      root.classList.contains("tg-compact") ||
      root.classList.contains("mobile-compact")
    )
  }, [isTelegram, isMobile])
  /* Telegram / compact chrome always use bottom-sheet overlay (never side split). */
  const splitView = (isTablet || isDesktop) && !compactChrome
  const mobileSheet = compactChrome && !splitView
  const sheetCompact = compactChrome

  const { snap, heightVh, isDragging, setSnap, handleProps, sheetStyle } = useMobileSheetSnap({
    enabled: mobileSheet,
    mapFocus,
    expandedSheet,
    defaultSnap,
  })

  useEffect(() => {
    if (!mobileSheet) return
    window.dispatchEvent(new Event("resize"))
  }, [mobileSheet, snap, heightVh])

  const sheetChildren = useMemo(() => filterSheetChildren(children, mobileSheet, snap), [children, mobileSheet, snap])

  /* Defer Leaflet mount one frame so sheet/text paint first (cuts "full load" scripting contention). */
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const idle = window.setTimeout(() => {
      if (!cancelled) setMapReady(true)
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(idle)
    }
  }, [])

  const mapProps = useMemo(() => ({
    pickup,
    destination,
    providers,
    providerPosition,
    requestPins,
    subtitle: mapSubtitle,
    showAllProviders,
    showDirectoryProviders,
    /* Always expose a user point so the pulsing blue marker + sheet-aware flyTo work. */
    userLocation: userLocation ?? pickup,
    onUserLocationChange,
    onPick,
    onAcceptRequest,
    onContactRequest,
    onRequestPinSelect,
    onProviderSelect,
    onRetryGeo,
    geoLoading,
    geoError,
    recenterTrigger,
    directoryScope,
    onDirectoryScopeChange,
    directoryScopeCity,
    directoryScopeGeoLoading,
    directoryScopeGeoError,
    onDirectoryScopeGeoRetry,
    directoryScopeRecenterTrigger,
    directoryScopeCityCenter,
    showUkraineMask,
    mapZoom,
    enableMotionZoom,
    motionSpeedMps,
    motionHeadingDeg,
    full: true as const,
    mapTileTheme,
    overlayMode: mobileSheet,
    /* Snap must reach the map so locate/flyTo can pad above the bottom sheet (incl. TG). */
    sheetSnap: mobileSheet ? snap : undefined,
  }), [
    pickup,
    destination,
    providers,
    providerPosition,
    requestPins,
    mapSubtitle,
    showAllProviders,
    showDirectoryProviders,
    userLocation,
    onUserLocationChange,
    onPick,
    onAcceptRequest,
    onContactRequest,
    onRequestPinSelect,
    onProviderSelect,
    onRetryGeo,
    geoLoading,
    geoError,
    recenterTrigger,
    directoryScope,
    onDirectoryScopeChange,
    directoryScopeCity,
    directoryScopeGeoLoading,
    directoryScopeGeoError,
    onDirectoryScopeGeoRetry,
    directoryScopeRecenterTrigger,
    directoryScopeCityCenter,
    showUkraineMask,
    mapZoom,
    enableMotionZoom,
    motionSpeedMps,
    motionHeadingDeg,
    mobileSheet,
    snap,
    mapTileTheme,
  ])

  if (splitView) {
    return (
      <div className="pomich-ride-screen pomich-ride-screen--split relative h-full min-h-0 w-full overflow-hidden pomich-ride-map-bg">
        <div className="pomich-ride-screen__map absolute inset-0 h-full w-full">
          {mapReady ? <LazyRouteMap key="pomich-ride-map" {...mapProps} showBrandBadge /> : null}
        </div>
        <div
          className={`pomich-sheet-panel pomich-sheet-panel--side z-[10] flex min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl ${
            isDesktop ? "w-[380px] max-w-[36vw]" : "w-[340px] max-w-[42vw]"
          }`}
          style={{
            position: "absolute",
            right: "var(--pomich-map-chrome-right, 12px)",
            /* Same vertical band as zoom / geo / POMICH chrome — no extra header margin */
            top: "var(--pomich-map-chrome-top)",
            bottom: "16px",
            height: "auto",
            marginTop: 0,
          }}
        >
          <div className="pomich-sheet-panel__scroll" onWheel={isolatePanelWheel}>
            <div className="p-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))]">{children}</div>
          </div>
        </div>
      </div>
    )
  }

  const rideScreenStyle = mobileSheet ? ({ ...sheetStyle, "--pomich-sheet-snap": snap } as CSSProperties) : undefined

  return (
    <div
      className={`pomich-ride-screen relative h-full min-h-0 overflow-hidden pomich-ride-map-bg${mobileSheet ? " pomich-ride-screen--overlay" : ""}`}
      style={rideScreenStyle}
      data-sheet-snap={mobileSheet ? snap : undefined}
    >
      <div className="pomich-ride-screen__map">
        {mapReady ? <LazyRouteMap key="pomich-ride-map" {...mapProps} /> : null}
      </div>
      <div
        className={`pomich-sheet-panel pomich-sheet-panel--bottom ${sheetCompact ? "tg-sheet-compact rounded-t-2xl" : "rounded-t-2xl"}`}
        data-snap={mobileSheet ? snap : undefined}
        data-dragging={mobileSheet && isDragging ? "true" : undefined}
        style={{
          ...sheetStyle,
          paddingLeft: sheetCompact ? "var(--pomich-space-3)" : "16px",
          paddingRight: sheetCompact ? "var(--pomich-space-3)" : "16px",
          paddingTop: 0,
        }}
      >
        <div className="pomich-sheet-handle" {...(mobileSheet ? handleProps : {})}>
          <span className="pomich-sheet-handle__bar" aria-hidden="true" />
          {mobileSheet && snap === "collapsed" ? (
            <button
              type="button"
              className="pomich-sheet-handle__expand"
              onClick={(event) => {
                event.stopPropagation()
                setSnap("half")
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="pomich-sheet-handle__expand-chevron" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                  <path d="M3.5 10.2 8 5.8l4.5 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Розгорнути
            </button>
          ) : null}
        </div>
        <div className="pomich-sheet-panel__scroll pomich-sheet-panel__scroll--bottom" onWheel={isolatePanelWheel}>
          <div className="pomich-sheet-panel__body">{sheetChildren}</div>
        </div>
      </div>
    </div>
  )
}

export default RideScreen
