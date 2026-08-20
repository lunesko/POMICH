import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { ProviderAvailability } from "../../api/client"
import type { Point } from "../../lib/constants"
import LazyRouteMap from "../map/LazyRouteMap"

const MAP_CENTER: Point = { lat: 48.6208, lng: 22.2879 }
const MAP_DESTINATION: Point = { lat: 48.625, lng: 22.295 }

const fallbackProviders: ProviderAvailability[] = [
  {
    id: "shell-oleksandr",
    name: "Олександр",
    status: "online",
    vehicle: "Volkswagen Transporter",
    rating: 4.9,
    etaMinutes: 12,
    location: { lat: 48.618, lng: 22.282 },
    specialties: ["tow", "fuel"],
  },
  {
    id: "shell-mykhailo",
    name: "Михайло",
    status: "busy",
    vehicle: "Renault Master",
    rating: 4.8,
    etaMinutes: 18,
    location: { lat: 48.628, lng: 22.301 },
    specialties: ["battery", "wheel"],
  },
]

interface MapAtmosphereContextValue {
  suppress: () => void
  release: () => void
  suppressed: boolean
}

const MapAtmosphereContext = createContext<MapAtmosphereContextValue | null>(null)

/** Decorative map + atmosphere + scrim — same treatment as landing hero. */
export function PomichMapBackground({
  providers,
  fadeBottom,
  variant = "shell",
  fixed = false,
}: {
  providers?: ProviderAvailability[]
  fadeBottom?: string
  /** `hero` = lighter landing scrim; `shell` = stronger readable overlay for forms/cabinets */
  variant?: "hero" | "shell"
  /** Pin to viewport so content scrolls over the map (landing + app shell). */
  fixed?: boolean
}) {
  const heroProviders = providers && providers.length > 0 ? providers : fallbackProviders
  /* Never CSS-transform the Leaflet tile layer — scale/translate opens a visible square
     grid between raster tiles on desktop Chrome/Firefox (and flicker on iOS). Motion stays
     on atmosphere orbs / brand / CTAs instead. */
  const mapLayerClass =
    variant === "hero" ? "landing-hero-map pomich-map-shell__map--static" : "pomich-map-shell__map--static"

  return (
    <div
      className={`pomich-map-shell__bg${fixed ? " pomich-map-shell__bg--fixed" : ""}`}
      aria-hidden="true"
    >
      <div className="pomich-map-shell__clip landing-hero-map-clip">
        <div className={`pomich-map-shell__map ${mapLayerClass}`.trim()}>
          <LazyRouteMap
            pickup={MAP_CENTER}
            destination={MAP_DESTINATION}
            providers={heroProviders}
            subtitle="POMICH live map"
            full
            showBadges={false}
            directoryOnly
            decorative
            mapTileTheme="light"
            ukraineMapFitCountry
          />
        </div>
      </div>
      {fadeBottom ? (
        <div className="pomich-map-shell__fade" style={{ background: fadeBottom }} />
      ) : null}
    </div>
  )
}

/** Local wrapper when a screen needs its own map layer (e.g. landing hero). */
export function PomichMapShell({
  children,
  className = "",
  providers,
  variant = "shell",
  fadeBottom,
}: {
  children: ReactNode
  className?: string
  providers?: ProviderAvailability[]
  variant?: "hero" | "shell"
  fadeBottom?: string
}) {
  return (
    <div className={`pomich-map-shell ${className}`.trim()}>
      <PomichMapBackground providers={providers} variant={variant} fadeBottom={fadeBottom} />
      <div className="pomich-map-shell__content">{children}</div>
    </div>
  )
}

/** App-root atmosphere: one decorative map for all non-ride / non-landing screens. */
export function MapAtmosphereProvider({ children }: { children: ReactNode }) {
  const [suppressCount, setSuppressCount] = useState(0)

  const suppress = useCallback(() => {
    setSuppressCount((n) => n + 1)
  }, [])

  const release = useCallback(() => {
    setSuppressCount((n) => Math.max(0, n - 1))
  }, [])

  const value = useMemo(
    () => ({
      suppress,
      release,
      suppressed: suppressCount > 0,
    }),
    [suppress, release, suppressCount],
  )

  return (
    <MapAtmosphereContext.Provider value={value}>
      <div className="pomich-map-shell pomich-map-shell--root">
        {!value.suppressed ? <PomichMapBackground variant="shell" fixed /> : null}
        <div className="pomich-map-shell__content">{children}</div>
      </div>
    </MapAtmosphereContext.Provider>
  )
}

/** Hide the global decorative map (RideScreen interactive map, landing hero map). */
export function useSuppressMapAtmosphere() {
  const ctx = useContext(MapAtmosphereContext)

  useEffect(() => {
    if (!ctx) return
    ctx.suppress()
    return () => ctx.release()
  }, [ctx])
}

export default PomichMapShell
