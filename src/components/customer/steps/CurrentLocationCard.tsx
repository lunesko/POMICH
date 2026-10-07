import { type ReactNode } from "react"
import LocationRow from "./LocationRow"
import GeoRefreshButton from "./GeoRefreshButton"
import { BORDER, SURFACE_TONE } from "./flowTheme"

export default function CurrentLocationCard({
  locationLabel,
  geoLoading,
  geoError,
  onRefreshGeo,
  onOpenGeoSettings,
  children,
}: {
  locationLabel: string
  geoLoading: boolean
  geoError?: string
  onRefreshGeo: () => void
  onOpenGeoSettings?: () => void
  children?: ReactNode
}) {
  return (
    <div style={{ marginTop: 0, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "2px 10px 8px", background: SURFACE_TONE }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <LocationRow icon="●" title="Поточне місце" subtitle={geoLoading ? "Визначаємо адресу…" : locationLabel} active />
        </div>
        <GeoRefreshButton loading={geoLoading} onClick={onRefreshGeo} />
      </div>
      {geoError ? (
        <div style={{ background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
          <div>{geoError}</div>
          {onOpenGeoSettings ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onOpenGeoSettings()
              }}
              style={{
                marginTop: 8,
                minHeight: 34,
                padding: "0 12px",
                borderRadius: 10,
                border: "1px solid currentColor",
                background: "transparent",
                color: "inherit",
                fontWeight: 900,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
                touchAction: "manipulation",
              }}
            >
              Налаштування гео
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}
