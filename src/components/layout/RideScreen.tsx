import type { ReactNode, WheelEvent } from "react"

import type { ProviderAvailability } from "../../api/client"
import { mediaQueries } from "../../lib/breakpoints"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import type { Point } from "../../lib/constants"
import RouteMap from "../map/RouteMap"

function isolatePanelWheel(event: WheelEvent<HTMLElement>) {
  event.stopPropagation()
}

interface RideScreenProps {
  pickup: Point
  destination?: Point
  providers?: ProviderAvailability[]
  providerPosition?: Point
  mapSubtitle?: string
  userLocation?: Point
  onUserLocationChange?: (point: Point) => void
  children: ReactNode
}

export function RideScreen({
  pickup,
  destination,
  providers,
  providerPosition,
  mapSubtitle,
  userLocation,
  onUserLocationChange,
  children,
}: RideScreenProps) {
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTablet = useMediaQuery(mediaQueries.tablet)
  const isDesktop = useMediaQuery(mediaQueries.desktop)
  const splitView = isTablet || isDesktop

  if (splitView) {
    return (
      <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#DDE7E2]">
        <div className="relative min-w-0 flex-1">
          <RouteMap
            pickup={pickup}
            destination={destination}
            providers={providers}
            providerPosition={providerPosition}
            subtitle={mapSubtitle}
            userLocation={userLocation ?? pickup}
            onUserLocationChange={onUserLocationChange}
            full
          />
          <div className="pointer-events-none absolute top-5 left-6 right-6 z-[1200] flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/95 px-3 py-2 text-sm font-extrabold text-dark shadow-lg">
              <span className="h-2 w-2 rounded-full bg-brand" />
              POMICH
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/95 px-3 py-2 text-xs font-extrabold text-gray-700 shadow-lg">
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

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#DDE7E2]">
      <RouteMap
        pickup={pickup}
        destination={destination}
        providers={providers}
        providerPosition={providerPosition}
        subtitle={mapSubtitle}
        userLocation={userLocation ?? pickup}
        onUserLocationChange={onUserLocationChange}
        full
      />
      <div className="pointer-events-none absolute top-3 left-3 right-3 z-[1200] flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/95 px-3 py-2 text-sm font-extrabold text-dark shadow-lg">
          <span className="h-2 w-2 rounded-full bg-brand" />
          POMICH
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-white/95 px-3 py-2 text-xs font-extrabold text-gray-700 shadow-lg">
          Допомога поруч
        </div>
      </div>
      <div
        className="pomich-sheet-panel absolute bottom-0 left-0 right-0 z-[1300] max-h-[min(70%,calc(100%-env(safe-area-inset-top,0px)-56px))] overflow-y-auto rounded-t-3xl shadow-2xl"
        style={{ padding: "10px 16px calc(16px + env(safe-area-inset-bottom, 0px))" }}
        onWheel={isolatePanelWheel}
      >
        <div className="mx-auto mb-3.5 h-1 w-12 rounded-full bg-gray-300" />
        {children}
      </div>
    </div>
  )
}

export default RideScreen
