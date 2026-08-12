import type { CSSProperties, ReactNode, WheelEvent } from "react"
import { Children, isValidElement, useEffect, useMemo } from "react"

import type { MapRequestPin, ProviderAvailability } from "../../api/client"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { useMobileSheetSnap } from "../../hooks/useMobileSheetSnap"
import type { Point } from "../../lib/constants"
import { getTelegramContext } from "../../telegram"
import RouteMap from "../map/RouteMap"

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
  recenterTrigger = 0,
  children,
}: RideScreenProps) {
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTablet = useMediaQuery(mediaQueries.tablet)
  const isDesktop = useMediaQuery(mediaQueries.desktop)
  const isTelegram = useMemo(() => getTelegramContext().isTelegram, [])
  const sheetCompact = isTelegram || isMobile
  const splitView = isTablet || isDesktop
  const mobileSheet = sheetCompact && !splitView

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
    userLocation: userLocation ?? pickup,
    onUserLocationChange,
    onPick,
    onAcceptRequest,
    onContactRequest,
    onRequestPinSelect,
    onRetryGeo,
    geoLoading,
    recenterTrigger,
    full: true as const,
    overlayMode: mobileSheet,
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
    recenterTrigger,
    mobileSheet,
    snap,
  ])

  if (splitView) {
    return (
      <div className="flex h-full min-h-0 w-full overflow-hidden pomich-ride-map-bg">
        <div className="relative min-w-0 flex-1">
          <RouteMap key="pomich-ride-map" {...mapProps} />
          <div className="pointer-events-none absolute top-5 left-6 right-6 z-[1200] flex items-center justify-between gap-3">
            <div className="pomich-map-chip pomich-map-chip--brand px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-brand" />
              POMICH
            </div>
            <div className="pomich-map-chip pomich-map-chip--muted px-3 py-2">
              Допомога поруч
            </div>
          </div>
        </div>
        <div
          className={`pomich-sheet-panel pomich-sheet-panel--side z-[1300] flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-l border-border shadow-2xl ${
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
        <div className="pomich-ride-screen__chrome pointer-events-none absolute top-3 left-3 right-3 flex items-center justify-between gap-3">
          <div className="pomich-map-chip pomich-map-chip--brand px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-brand" />
            POMICH
          </div>
          <div className="pomich-map-chip pomich-map-chip--muted px-3 py-2">
            Допомога поруч
          </div>
        </div>
      </div>
      <div
        className={`pomich-sheet-panel pomich-sheet-panel--bottom shadow-2xl ${sheetCompact ? "tg-sheet-compact rounded-t-2xl" : "rounded-t-3xl"}`}
        data-snap={mobileSheet ? snap : undefined}
        data-dragging={mobileSheet && isDragging ? "true" : undefined}
        style={{
          ...sheetStyle,
          padding: sheetCompact ? "0 var(--pomich-space-3) calc(var(--pomich-space-3) + env(safe-area-inset-bottom, 0px))" : "0 16px calc(16px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="pomich-sheet-handle" {...(mobileSheet ? handleProps : {})}>
          <span className="pomich-sheet-handle__bar" aria-hidden="true" />
          {mobileSheet ? (
            <span className="pomich-sheet-handle__hint">
              {isDragging
                ? "Тримайте і перетягніть"
                : snap === "collapsed"
                  ? "Проведіть вгору"
                  : snap === "expanded"
                    ? "Проведіть вниз"
                    : "Панель · перетягніть"}
            </span>
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
