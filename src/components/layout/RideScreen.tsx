import type { CSSProperties, ReactNode, WheelEvent } from "react"
import { Children, isValidElement, useEffect, useMemo } from "react"

import type { MapRequestPin, ProviderAvailability } from "../../api/client"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { useMobileSheetSnap } from "../../hooks/useMobileSheetSnap"
import type { Point } from "../../lib/constants"
import { getTelegramContext } from "../../telegram"
import RouteMap from "../map/RouteMap"
import { useSuppressMapAtmosphere } from "./PomichMapShell"

function isolatePanelWheel(event: WheelEvent<HTMLElement>) {
  event.stopPropagation()
}

function filterSheetChildren(children: ReactNode, mobileSheet: boolean, snap: "collapsed" | "half" | "expanded") {
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
  userLocation?: Point
  onUserLocationChange?: (point: Point) => void
  onPick?: (point: Point) => void
  onAcceptRequest?: (pin: MapRequestPin) => void
  onContactRequest?: (pin: MapRequestPin) => void
  onRequestPinSelect?: (pin: MapRequestPin) => void
  expandedSheet?: boolean
  mapFocus?: boolean
  onRetryGeo?: () => void
  geoLoading?: boolean
  geoError?: string
  recenterTrigger?: number
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
  userLocation,
  onUserLocationChange,
  onPick,
  onAcceptRequest,
  onContactRequest,
  onRequestPinSelect,
  expandedSheet = false,
  mapFocus = false,
  onRetryGeo,
  geoLoading = false,
  geoError,
  recenterTrigger = 0,
  children,
}: RideScreenProps) {
  /* Interactive ride map owns the viewport — don't stack decorative shell map underneath. */
  useSuppressMapAtmosphere()
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

  const { snap, heightVh, isDragging, handleProps, sheetStyle } = useMobileSheetSnap({
    enabled: mobileSheet,
    mapFocus,
    expandedSheet,
  })

  useEffect(() => {
    if (!mobileSheet) return
    window.dispatchEvent(new Event("resize"))
  }, [mobileSheet, snap, heightVh])

  const sheetChildren = useMemo(() => filterSheetChildren(children, mobileSheet, snap), [children, mobileSheet, snap])

  const mapProps = useMemo(() => ({
    pickup,
    destination,
    providers,
    providerPosition,
    requestPins,
    subtitle: mapSubtitle,
    showAllProviders,
    /* Always expose a user point so the pulsing blue marker + sheet-aware flyTo work. */
    userLocation: userLocation ?? pickup,
    onUserLocationChange,
    onPick,
    onAcceptRequest,
    onContactRequest,
    onRequestPinSelect,
    onRetryGeo,
    geoLoading,
    geoError,
    recenterTrigger,
    full: true as const,
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
    userLocation,
    onUserLocationChange,
    onPick,
    onAcceptRequest,
    onContactRequest,
    onRequestPinSelect,
    onRetryGeo,
    geoLoading,
    geoError,
    recenterTrigger,
    mobileSheet,
    snap,
  ])

  if (splitView) {
    return (
      <div className="pomich-ride-screen pomich-ride-screen--split flex flex-row h-full min-h-0 w-full overflow-hidden pomich-ride-map-bg">
        <div className="pomich-ride-screen__map relative min-h-0 min-w-0 flex-1 self-stretch">
          <RouteMap key="pomich-ride-map" {...mapProps} />
          {/* Desktop only: live badge beside zoom. Hidden on TG/mobile — avoids covering +/- */}
          <div className="pomich-ride-screen__chrome pomich-ride-screen__chrome--desktop pointer-events-none absolute">
            <div className="pomich-map-chip pomich-map-chip--brand px-3 py-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
              POMICH
            </div>
          </div>
        </div>
        <div
          className={`pomich-sheet-panel pomich-sheet-panel--side z-[5] flex h-full min-h-0 shrink-0 flex-col self-stretch overflow-hidden border-l border-border shadow-2xl ${
            isDesktop ? "w-[420px] max-w-[38vw]" : "w-[360px] max-w-[44vw]"
          }`}
        >
          <div className="pomich-sheet-panel__scroll" onWheel={isolatePanelWheel}>
            <div className="p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))]">{children}</div>
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
        <RouteMap key="pomich-ride-map" {...mapProps} />
      </div>
      <div
        className={`pomich-sheet-panel pomich-sheet-panel--bottom shadow-2xl ${sheetCompact ? "tg-sheet-compact rounded-t-2xl" : "rounded-t-3xl"}`}
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
        </div>
        <div className="pomich-sheet-panel__scroll pomich-sheet-panel__scroll--bottom" onWheel={isolatePanelWheel}>
          <div className="pomich-sheet-panel__body">{sheetChildren}</div>
        </div>
      </div>
    </div>
  )
}

export default RideScreen
