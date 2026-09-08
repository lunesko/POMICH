import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import DecorativeBasemap from "../map/DecorativeBasemap"

interface MapAtmosphereContextValue {
  suppress: () => void
  release: () => void
  suppressed: boolean
}

const MapAtmosphereContext = createContext<MapAtmosphereContextValue | null>(null)

/** Decorative map + atmosphere + scrim — same treatment as landing hero. */
export function PomichMapBackground({
  fadeBottom,
  variant = "shell",
  fixed = false,
}: {
  providers?: unknown
  fadeBottom?: string
  /** `hero` = lighter landing scrim; `shell` = stronger readable overlay for forms/cabinets */
  variant?: "hero" | "shell"
  /** Pin to viewport so content scrolls over the map (landing + app shell). */
  fixed?: boolean
}) {
  /* Live Leaflet tiles always show a square grid on iOS Safari (subpixel gaps + flicker).
     Decorative atmosphere uses one stitched raster instead — zero tile seams. */
  const mapLayerClass =
    variant === "hero" ? "landing-hero-map pomich-map-shell__map--static" : "pomich-map-shell__map--static"

  return (
    <div
      className={`pomich-map-shell__bg${fixed ? " pomich-map-shell__bg--fixed" : ""}`}
      aria-hidden="true"
    >
      <div className="pomich-map-shell__clip landing-hero-map-clip">
        <div className={`pomich-map-shell__map ${mapLayerClass}`.trim()}>
          <DecorativeBasemap />
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
  providers?: unknown
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
