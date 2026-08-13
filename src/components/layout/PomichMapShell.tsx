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
import { usePomichTheme } from "../../context/PomichThemeProvider"
import RouteMap from "../map/RouteMap"

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
  const { isDark } = usePomichTheme()
  const heroProviders = providers && providers.length > 0 ? providers : fallbackProviders

  /* Soft map wash only — readable copy uses local .landing-hero-content / .pomich-map-copy-plate */
  const overlayBg =
    variant === "hero"
      ? isDark
        ? "linear-gradient(105deg, rgba(8,12,14,0.42) 0%, rgba(8,12,14,0.18) 36%, rgba(8,12,14,0.04) 64%, transparent 100%)"
        : "linear-gradient(105deg, rgba(244,249,247,0.5) 0%, rgba(244,249,247,0.22) 38%, rgba(244,249,247,0.05) 68%, transparent 100%)"
      : isDark
        ? "linear-gradient(165deg, rgba(8,12,14,0.22) 0%, rgba(8,12,14,0.12) 45%, rgba(8,12,14,0.18) 100%)"
        : "linear-gradient(165deg, rgba(244,249,247,0.28) 0%, rgba(244,249,247,0.16) 45%, rgba(244,249,247,0.22) 100%)"

  return (
    <div
      className={`pomich-map-shell__bg${fixed ? " pomich-map-shell__bg--fixed" : ""}`}
      aria-hidden="true"
    >
      <div className="pomich-map-shell__clip landing-hero-map-clip">
        <div
          className="pomich-map-shell__map landing-hero-map"
          style={{
            opacity: isDark ? 0.88 : 0.98,
            filter: isDark
              ? "saturate(1.2) contrast(1.1) brightness(0.98)"
              : "saturate(1.12) contrast(1.12) brightness(1.05)",
          }}
        >
          <RouteMap
            pickup={MAP_CENTER}
            destination={MAP_DESTINATION}
            providers={heroProviders}
            subtitle="POMICH live map"
            full
            showBadges={false}
            directoryOnly
            decorative
          />
        </div>
      </div>
      <div className="pomich-map-shell__atmosphere landing-hero-atmosphere">
        <span className="landing-hero-orb landing-hero-orb--a" />
        <span className="landing-hero-orb landing-hero-orb--b" />
        <span className="landing-hero-orb landing-hero-orb--c" />
        <span className="landing-hero-grain" />
        <span className="landing-hero-scan" />
      </div>
      <div className="pomich-map-shell__scrim landing-hero-scrim" style={{ background: overlayBg }} />
      <div
        className="pomich-map-shell__vignette landing-hero-vignette"
        style={{
          background: isDark
            ? "radial-gradient(ellipse 75% 60% at 50% 45%, transparent 48%, rgba(4,8,10,0.22) 100%), radial-gradient(ellipse 55% 50% at 16% 48%, rgba(22,163,106,0.12), transparent 64%)"
            : "radial-gradient(ellipse 75% 60% at 50% 45%, transparent 52%, rgba(20,40,35,0.06) 100%), radial-gradient(ellipse 55% 50% at 16% 48%, rgba(22,163,106,0.08), transparent 64%)",
        }}
      />
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
