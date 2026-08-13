import { useEffect, useMemo, useRef, useState } from "react"

import type { LatLngTuple } from "leaflet"

import L from "leaflet"

import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet"

import "leaflet/dist/leaflet.css"



import type { MapRequestPin, ProviderAvailability } from "../../api/client"

import {

  BORDER,

  BRAND,

  DARK,

  directoryCategoryFilters,

  getDirectoryIconColor,

  getDirectoryIconEmoji,

  getDirectoryPrimarySpecialty,

  getProviderCapabilityLabel,

  normalizeTelHref,

  normalizeTelegramHref,

  provider,

  providerPoint,

  isProviderAvailable,

  isDirectoryMapProvider,

  distanceToProvider,

  providerStatusLabel,

  toServiceKeys,

  toTuple,

  type DirectoryCategoryKey,

  type Point,

} from "../../lib/constants"

import { fetchOsrmRoute, formatRouteDistance, formatRouteDuration, forwardGeocodeAddress } from "../../lib/osrmRoute"

import ClickToPick from "./ClickToPick"

import UkraineMapLayers from "./UkraineMapLayers"

import MapSizeController from "./MapSizeController"

import {
  MAP_GEO_DEBOUNCE_MS,
  MAP_RECENTER_THRESHOLD_M,
  moveMapToPoint,
  requestCurrentPosition,
  resolveSheetBottomPaddingPx,
  shouldRecenterMap,
} from "../../lib/mapGeo"

import { readSheetHeights, type SheetSnap } from "../../hooks/useMobileSheetSnap"
import { resolveMapTileConfig, type MapTileTheme } from "../../lib/theme"
import { isOccupiedCoordinates, OCCUPIED_PICK_MESSAGE } from "../../lib/occupiedTerritories"
import type { DirectoryScopeMode } from "../../lib/directoryScope"
import { UKRAINE_BOUNDS, UKRAINE_MAP_FIT_MAX_ZOOM, UKRAINE_MAP_FIT_MAX_ZOOM_MOBILE } from "../../lib/ukraineMapMask"

function sheetPaddingBottomPx(
  map: { getSize: () => { x: number; y: number } },
  sheetSnap?: SheetSnap,
  overlayMode = false,
): number {
  const heights = readSheetHeights()
  return resolveSheetBottomPaddingPx(sheetSnap, map.getSize().y, heights, { overlayMode })
}

function afterLayout(cb: () => void): () => void {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const id = window.requestAnimationFrame(cb)
    return () => window.cancelAnimationFrame(id)
  }
  const id = window.setTimeout(cb, 0)
  return () => window.clearTimeout(id)
}



function DisableMapInteractions() {
  const map = useMap()
  useEffect(() => {
    map.scrollWheelZoom?.disable()
    map.dragging?.disable()
    map.touchZoom?.disable()
    map.doubleClickZoom?.disable()
    map.boxZoom?.disable()
    map.keyboard?.disable()
  }, [map])
  return null
}

function MapPointerScrollZoom() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const zoom = map.scrollWheelZoom
    if (!zoom) return

    const enableZoom = () => {
      zoom.enable()
    }
    const disableZoom = () => {
      zoom.disable()
    }

    disableZoom()
    container.addEventListener("mouseenter", enableZoom)
    container.addEventListener("mouseleave", disableZoom)
    container.addEventListener("focusin", enableZoom)
    container.addEventListener("focusout", disableZoom)

    return () => {
      container.removeEventListener("mouseenter", enableZoom)
      container.removeEventListener("mouseleave", disableZoom)
      container.removeEventListener("focusin", enableZoom)
      container.removeEventListener("focusout", disableZoom)
    }
  }, [map])
  return null
}

function MapThemeTileLayer({ mapTileTheme }: { mapTileTheme: MapTileTheme }) {
  const tile = resolveMapTileConfig({ mapTileTheme })
  const usesSubdomains = tile.url.includes("{s}")
  return (
    <TileLayer
      key={tile.url}
      url={tile.url}
      maxZoom={19}
      {...(usesSubdomains && tile.subdomains ? { subdomains: tile.subdomains } : {})}
      attribution={tile.attribution}
    />
  )
}

function FitRouteBounds({ coords }: { coords: LatLngTuple[] }) {
  const map = useMap()
  useEffect(() => {
    if (coords.length < 2) return
    map.fitBounds(L.latLngBounds(coords), { padding: [52, 52] })
  }, [coords, map])
  return null
}

function MapExplicitRecenter({
  point,
  trigger,
  sheetSnap,
  overlayMode = false,
}: {
  point: LatLngTuple
  trigger: number
  sheetSnap?: SheetSnap
  overlayMode?: boolean
}) {
  const map = useMap()
  const pointRef = useRef(point)
  const lastTriggerRef = useRef(0)

  pointRef.current = point

  useEffect(() => {
    if (trigger <= 0 || trigger === lastTriggerRef.current) return
    lastTriggerRef.current = trigger
    // Wait a frame so overlay sheet layout / map size are settled (Telegram WebApp).
    return afterLayout(() => {
      moveMapToPoint(map, pointRef.current, {
        animateLarge: true,
        paddingBottom: sheetPaddingBottomPx(map, sheetSnap, overlayMode),
      })
    })
  }, [trigger, map, sheetSnap, overlayMode])

  return null
}

function MapDebouncedFollow({
  point,
  enabled,
  recenterTrigger = 0,
  sheetSnap,
  overlayMode = false,
}: {
  point: LatLngTuple
  enabled: boolean
  recenterTrigger?: number
  sheetSnap?: SheetSnap
  overlayMode?: boolean
}) {
  const map = useMap()
  const lastCenterRef = useRef<LatLngTuple | null>(null)
  const lastTriggerRef = useRef(recenterTrigger)

  useEffect(() => {
    if (recenterTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = recenterTrigger
      lastCenterRef.current = point
    }
  }, [point, recenterTrigger])

  useEffect(() => {
    if (!enabled) return

    const timeoutId = window.setTimeout(() => {
      const from = lastCenterRef.current ?? (() => {
        const center = map.getCenter()
        return [center.lat, center.lng] as LatLngTuple
      })()

      const nextPoint = { lat: point[0], lng: point[1] }
      const fromPoint = { lat: from[0], lng: from[1] }
      if (!shouldRecenterMap(fromPoint, nextPoint, MAP_RECENTER_THRESHOLD_M)) return

      moveMapToPoint(map, point, {
        animateLarge: false,
        paddingBottom: sheetPaddingBottomPx(map, sheetSnap, overlayMode),
      })
      lastCenterRef.current = point
    }, MAP_GEO_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [enabled, map, point, sheetSnap, overlayMode])

  return null
}

/** After locate / while following — re-pad when the bottom sheet snap changes. */
function MapKeepVisibleAboveSheet({
  point,
  sheetSnap,
  overlayMode = false,
  active,
}: {
  point: LatLngTuple
  sheetSnap?: SheetSnap
  overlayMode?: boolean
  active: boolean
}) {
  const map = useMap()
  const pointRef = useRef(point)
  pointRef.current = point

  useEffect(() => {
    if (!active || (!sheetSnap && !overlayMode)) return
    return afterLayout(() => {
      moveMapToPoint(map, pointRef.current, {
        animateLarge: false,
        paddingBottom: sheetPaddingBottomPx(map, sheetSnap, overlayMode),
      })
    })
  }, [active, map, sheetSnap, overlayMode])

  return null
}

function MapDirectoryScopeRecenter({
  scope,
  cityCenter,
  trigger,
  compact,
}: {
  scope: DirectoryScopeMode
  cityCenter?: Point
  trigger: number
  compact?: boolean
}) {
  const map = useMap()
  const lastTriggerRef = useRef(0)

  useEffect(() => {
    if (trigger <= 0 || trigger === lastTriggerRef.current) return
    lastTriggerRef.current = trigger
    return afterLayout(() => {
      if (scope === "all-ukraine") {
        const [south, west, north, east] = UKRAINE_BOUNDS
        map.fitBounds(
          [
            [south, west],
            [north, east],
          ],
          {
            padding: [24, 24],
            maxZoom: compact ? UKRAINE_MAP_FIT_MAX_ZOOM_MOBILE : UKRAINE_MAP_FIT_MAX_ZOOM,
            animate: true,
          },
        )
        return
      }
      if (cityCenter) {
        moveMapToPoint(map, [cityCenter.lat, cityCenter.lng], { animateLarge: true, minZoom: 13 })
      }
    })
  }, [trigger, scope, cityCenter, compact, map])

  return null
}

const DIRECTORY_VIEWPORT_CULL_THRESHOLD = 50

/** Per-viewport caps — never sample the whole country when zoomed into a region. */
export function directoryMaxMarkersForZoom(zoom: number): number {
  if (zoom <= 7) return 250
  if (zoom <= 10) return 200
  return 500
}

function directoryViewportPad(zoom: number): number {
  if (zoom <= 7) return 0.22
  if (zoom <= 9) return 0.16
  return 0.1
}

export function selectDirectoryProvidersForRender(
  providers: ProviderAvailability[],
  map: L.Map,
): ProviderAvailability[] {
  const zoom = typeof map.getZoom === "function" ? map.getZoom() : 13
  const maxMarkers = directoryMaxMarkersForZoom(zoom)
  let candidates = providers

  const useViewportCull = providers.length > DIRECTORY_VIEWPORT_CULL_THRESHOLD || zoom <= 10

  if (useViewportCull) {
    if (typeof map.getBounds !== "function") {
      return providers.length <= maxMarkers ? providers : providers.slice(0, maxMarkers)
    }
    const bounds = map.getBounds().pad(directoryViewportPad(zoom))
    candidates = providers.filter((item) => {
      const point = providerPoint(item)
      return point ? bounds.contains([point.lat, point.lng]) : false
    })
  }

  if (candidates.length <= maxMarkers) return candidates

  const step = candidates.length / maxMarkers
  const sampled: ProviderAvailability[] = []
  for (let i = 0; i < maxMarkers; i += 1) {
    sampled.push(candidates[Math.floor(i * step)]!)
  }
  return sampled
}

function DirectoryProviderMarkers({
  providers,
  userLocation,
  pickup,
  onProviderSelect,
  onRoute,
  navLoading,
  navTargetProviderId,
  navRouteCoords,
  navRouteLabel,
}: {
  providers: ProviderAvailability[]
  userLocation?: Point
  pickup: Point
  onProviderSelect?: (provider: ProviderAvailability) => void
  onRoute: (item: ProviderAvailability) => void
  navLoading: boolean
  navTargetProviderId: string | null
  navRouteCoords: LatLngTuple[] | null
  navRouteLabel: string | null
}) {
  const map = useMap()
  const [renderProviders, setRenderProviders] = useState(() => selectDirectoryProvidersForRender(providers, map))

  useEffect(() => {
    const syncVisible = () => {
      setRenderProviders(selectDirectoryProvidersForRender(providers, map))
    }

    syncVisible()
    if (typeof map.on !== "function" || typeof map.off !== "function") return
    map.on("moveend", syncVisible)
    map.on("zoomend", syncVisible)
    return () => {
      map.off("moveend", syncVisible)
      map.off("zoomend", syncVisible)
    }
  }, [map, providers])

  return (
    <>
      {renderProviders.map((item) => {
        const point = providerPoint(item)
        return point ? (
          <Marker
            key={item.id}
            position={toTuple(point)}
            icon={directoryProviderIcon(item)}
            eventHandlers={
              onProviderSelect
                ? {
                    click: () => {
                      const distanceKm = distanceToProvider(userLocation ?? pickup, item)
                      onProviderSelect({
                        ...item,
                        distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(1)) : undefined,
                        etaMinutes:
                          item.etaMinutes ??
                          (Number.isFinite(distanceKm) ? Math.max(5, Math.ceil(distanceKm * 4)) : undefined),
                      })
                    },
                  }
                : undefined
            }
          >
            {onProviderSelect ? null : (
              <Popup>
                <DirectoryPopup
                  item={item}
                  onRoute={() => onRoute(item)}
                  routeLoading={navLoading && navTargetProviderId === item.id}
                  routeActive={navTargetProviderId === item.id && Boolean(navRouteCoords)}
                  routeLabel={navTargetProviderId === item.id ? navRouteLabel : null}
                />
              </Popup>
            )}
          </Marker>
        ) : null
      })}
    </>
  )
}



const pickupIcon = L.divIcon({

  className: "pomich-pickup-marker",

  html: '<div style="width:24px;height:24px;border-radius:999px;background:#16A36A;border:3px solid white"></div>',

  iconSize: [24, 24],

  iconAnchor: [12, 12],

})



const destinationIcon = L.divIcon({

  className: "pomich-destination-marker",

  html: '<div style="width:24px;height:24px;border-radius:999px;background:#2563EB;border:3px solid white"></div>',

  iconSize: [24, 24],

  iconAnchor: [12, 12],

})



const partnerIcon = L.divIcon({

  className: "pomich-partner-marker",

  html: '<div style="width:28px;height:28px;border-radius:999px;background:#F59E0B;border:3px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:13px">🚛</div>',

  iconSize: [28, 28],

  iconAnchor: [14, 14],

})



const liveProviderIcon = L.divIcon({

  className: "pomich-live-provider-marker",

  html: '<div style="width:28px;height:28px;border-radius:999px;background:#F59E0B;border:3px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:13px">🚛</div>',

  iconSize: [28, 28],

  iconAnchor: [14, 14],

})



const userLocationIcon = L.divIcon({
  className: "pomich-user-location-marker",
  html:
    '<div class="pomich-user-loc" aria-hidden="true">' +
    '<span class="pomich-user-loc__pulse"></span>' +
    '<span class="pomich-user-loc__pulse pomich-user-loc__pulse--delayed"></span>' +
    '<span class="pomich-user-loc__dot"></span>' +
    "</div>",
  iconSize: [72, 72],
  iconAnchor: [36, 36],
})



const requestIcon = L.divIcon({

  className: "pomich-request-marker",

  html: '<div style="width:30px;height:30px;border-radius:999px;background:#EF4444;border:3px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:14px">!</div>',

  iconSize: [30, 30],

  iconAnchor: [15, 15],

})



const directoryIconCache = new Map<string, L.DivIcon>()



function directoryProviderIcon(item: ProviderAvailability): L.DivIcon {

  const specialty = getDirectoryPrimarySpecialty(item)

  const emoji = getDirectoryIconEmoji(item)

  const color = getDirectoryIconColor(specialty)

  const cached = directoryIconCache.get(specialty)

  if (cached) return cached

  const icon = L.divIcon({

    className: "pomich-directory-marker",

    html: `<div style="width:26px;height:26px;border-radius:8px;background:${color};border:2px solid white;display:flex;align-items:center;justify-content:center;color:white;font-size:12px">${emoji}</div>`,

    iconSize: [26, 26],

    iconAnchor: [13, 13],

  })

  directoryIconCache.set(specialty, icon)

  return icon

}



function LivePartnerPopup({ item }: { item: ProviderAvailability }) {
  const telHref = normalizeTelHref(item.phone)
  const telegramHref = normalizeTelegramHref(item.telegram)
  const services = toServiceKeys(item.specialties)
  const specialty = getDirectoryPrimarySpecialty(item)

  return (
    <div style={{ minWidth: 220, maxWidth: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{getDirectoryIconEmoji(item)}</span>
        <strong style={{ lineHeight: 1.25 }}>{item.name}</strong>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "#4B5563", fontWeight: 700 }}>
        {providerStatusLabel(item.status)}
        {typeof item.rating === "number" ? ` · ★ ${item.rating.toFixed(1)}` : ""}
        {item.etaMinutes ? ` · ~${item.etaMinutes} хв` : ""}
      </div>
      {item.vehicle ? <div style={{ marginTop: 6, fontSize: 12, color: "#374151" }}>{item.vehicle}</div> : null}
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(services.length > 0 ? services : [specialty]).map((service) => (
          <span key={service} style={{ borderRadius: 999, padding: "5px 9px", background: "#E8F8F1", color: BRAND, fontSize: 11, fontWeight: 900 }}>
            {getProviderCapabilityLabel(service)}
          </span>
        ))}
      </div>
      {telHref ? (
        <a href={telHref} style={{ display: "inline-block", marginTop: 10, fontSize: 14, fontWeight: 900, color: BRAND, textDecoration: "none" }}>
          📞 {item.phone}
        </a>
      ) : (
        <div style={{ marginTop: 10, fontSize: 11, color: "#9CA3AF", fontWeight: 700 }}>Телефон не вказано</div>
      )}
      {telegramHref ? (
        <a href={telegramHref} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 13, fontWeight: 800, color: "#2563EB", textDecoration: "none" }}>
          Telegram @{item.telegram?.replace(/^@+/, "")}
        </a>
      ) : null}
    </div>
  )
}

function DirectoryPopup({
  item,
  onRoute,
  routeLoading,
  routeActive,
  routeLabel,
}: {
  item: ProviderAvailability
  onRoute: () => void
  routeLoading?: boolean
  routeActive?: boolean
  routeLabel?: string | null
}) {
  const specialty = getDirectoryPrimarySpecialty(item)
  const serviceLabel = getProviderCapabilityLabel(specialty)
  const telHref = normalizeTelHref(item.phone)
  const services = toServiceKeys(item.specialties)

  return (
    <div style={{ minWidth: 200, maxWidth: 260 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{getDirectoryIconEmoji(item)}</span>
        <strong style={{ lineHeight: 1.25 }}>{item.name}</strong>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "#4B5563", fontWeight: 700 }}>{serviceLabel}</div>
      {item.address ? <div style={{ marginTop: 6, fontSize: 12, color: "#374151" }}>{item.address}</div> : null}
      {telHref ? (
        <a href={telHref} style={{ display: "inline-block", marginTop: 8, fontSize: 13, fontWeight: 800, color: BRAND, textDecoration: "none" }}>
          {item.phone}
        </a>
      ) : (
        <div style={{ marginTop: 8, fontSize: 11, color: "#9CA3AF", fontWeight: 700 }}>Телефон у довіднику відсутній</div>
      )}
      {item.openingHours ? <div style={{ marginTop: 6, fontSize: 11, color: "#6B7280" }}>🕐 {item.openingHours}</div> : null}
      {item.website ? (
        <a href={item.website.startsWith("http") ? item.website : `https://${item.website}`} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 6, fontSize: 11, color: "#2563EB", textDecoration: "none" }}>
          Сайт
        </a>
      ) : null}
      {services.length > 1 ? (
        <div style={{ marginTop: 8, fontSize: 10, color: "#6B7280", fontWeight: 700 }}>
          {services.map(getProviderCapabilityLabel).join(" · ")}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onRoute}
        disabled={routeLoading}
        style={{
          width: "100%",
          marginTop: 10,
          border: "none",
          borderRadius: 10,
          background: routeActive ? "#F3F4F6" : BRAND,
          color: routeActive ? DARK : "#fff",
          padding: "9px 10px",
          fontWeight: 800,
          fontSize: 13,
          cursor: routeLoading ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {routeLoading ? "Будуємо маршрут…" : routeActive ? "Скасувати маршрут" : "Прокласти маршрут"}
      </button>
      {routeActive && routeLabel ? (
        <div style={{ marginTop: 6, fontSize: 11, color: BRAND, fontWeight: 800 }}>{routeLabel}</div>
      ) : null}
      {item.contactStatus === "directory_only" ? (
        <div style={{ marginTop: 8, fontSize: 10, color: "#9CA3AF" }}>Довідник · OpenStreetMap</div>
      ) : null}
    </div>
  )
}

function RouteOriginSheet({
  address,
  geocoding,
  geoRequesting,
  pickMode,
  error,
  onAddressChange,
  onSubmitAddress,
  onRequestGeo,
  onPickOnMap,
  onClose,
}: {
  address: string
  geocoding?: boolean
  geoRequesting?: boolean
  pickMode?: boolean
  error?: string
  onAddressChange: (value: string) => void
  onSubmitAddress: () => void
  onRequestGeo: () => void
  onPickOnMap: () => void
  onClose: () => void
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1250,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: pickMode ? "transparent" : "rgba(17,19,21,0.42)",
        padding: 12,
        pointerEvents: pickMode ? "none" : "auto",
      }}
      onClick={pickMode ? undefined : onClose}
    >
      <div
        style={{
          width: "min(100%, 380px)",
          borderRadius: 18,
          background: "var(--pomich-surface)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: `1px solid ${BORDER}`,
          padding: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
          pointerEvents: "auto",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ fontWeight: 950, fontSize: 17, color: DARK }}>Укажіть звідки їхати</div>
        <div style={{ marginTop: 6, color: "#6B7280", fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>
          Увімкніть геолокацію, введіть адресу або оберіть точку на карті.
        </div>
        <label style={{ display: "grid", gap: 6, marginTop: 14 }}>
          <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Адреса відправлення</span>
          <input
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder="Напр. вул. Хрещатик, Київ"
            className="pomich-form-input"
            style={{ color: DARK }}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmitAddress()
            }}
          />
        </label>
        {error ? (
          <div style={{ marginTop: 10, background: "#FFF7ED", color: "#B45309", borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 800 }}>
            {error}
          </div>
        ) : null}
        {pickMode ? (
          <div style={{ marginTop: 10, background: "#EFF6FF", color: "#1D4ED8", borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 800 }}>
            Натисніть на карті, щоб обрати точку відправлення.
          </div>
        ) : null}
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            onClick={onSubmitAddress}
            disabled={geocoding || !address.trim()}
            style={{
              minHeight: 44,
              border: "none",
              borderRadius: 12,
              background: geocoding || !address.trim() ? "#CBD5E1" : BRAND,
              color: "#fff",
              fontWeight: 900,
              cursor: geocoding || !address.trim() ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {geocoding ? "Шукаємо адресу…" : "Прокласти з цієї адреси"}
          </button>
          <button
            type="button"
            onClick={onRequestGeo}
            disabled={geoRequesting}
            style={{
              minHeight: 44,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              background: "var(--pomich-surface)",
              backdropFilter: "blur(14px)",
              WebkitBackdropFilter: "blur(14px)",
              color: DARK,
              fontWeight: 900,
              cursor: geoRequesting ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {geoRequesting ? "Визначаємо…" : "📍 Увімкнути геолокацію"}
          </button>
          <button
            type="button"
            onClick={onPickOnMap}
            style={{
              minHeight: 44,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              background: pickMode ? "#E8F8F1" : "#F9FAFB",
              color: DARK,
              fontWeight: 900,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {pickMode ? "Оберіть точку на карті ↑" : "🗺️ Обрати на карті"}
          </button>
        </div>
      </div>
    </div>
  )
}



function MapLegend({ directoryOnly, hasDestination, hasPartner }: { directoryOnly?: boolean; hasDestination?: boolean; hasPartner?: boolean; overlayMode?: boolean }) {
  if (directoryOnly) {
    return (
      <div className="pomich-map-legend-box">
        <span className="pomich-map-legend-title">Легенда</span>
        <span>🔧 Сервіс / СТО</span>
        <span>🟣 Ваше місце</span>
        <span>🔵 Маршрут</span>
      </div>
    )
  }

  return (
    <div className="pomich-map-legend-box">
      <span className="pomich-map-legend-title">Легенда</span>
      <span>🟢 Клієнт</span>
      {hasPartner ? <span>🟠 Партнер</span> : <span>🚛 Партнер на лінії</span>}
      {hasDestination ? <span>🔵 Пункт призначення</span> : null}
      <span>🔧 Сервіс</span>
      <span>🔴 Заявка</span>
    </div>
  )
}




function LocateCrosshairIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={spinning ? { animation: "pomich-locate-spin 0.9s linear infinite" } : undefined}
    >
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <circle cx="12" cy="12" r="7.2" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function MapLocateFlyTo({
  point,
  trigger,
  sheetSnap,
  overlayMode = false,
}: {
  point: LatLngTuple | null
  trigger: number
  sheetSnap?: SheetSnap
  overlayMode?: boolean
}) {
  const map = useMap()
  const lastTriggerRef = useRef(0)

  useEffect(() => {
    if (!point || trigger <= 0 || trigger === lastTriggerRef.current) return
    lastTriggerRef.current = trigger
    return afterLayout(() => {
      moveMapToPoint(map, point, {
        animateLarge: true,
        paddingBottom: sheetPaddingBottomPx(map, sheetSnap, overlayMode),
      })
    })
  }, [map, point, trigger, sheetSnap, overlayMode])

  return null
}

interface RouteMapProps {

  pickup: Point

  destination?: Point

  providers?: ProviderAvailability[]

  providerPosition?: Point

  requestPins?: MapRequestPin[]

  subtitle?: string

  onPick?: (point: Point) => void

  onAcceptRequest?: (pin: MapRequestPin) => void

  onContactRequest?: (pin: MapRequestPin) => void

  onRequestPinSelect?: (pin: MapRequestPin) => void

  onProviderSelect?: (provider: ProviderAvailability) => void

  full?: boolean

  showBadges?: boolean

  showAllProviders?: boolean

  showDirectoryProviders?: boolean

  directoryOnly?: boolean

  userLocation?: Point

  onUserLocationChange?: (point: Point) => void

  decorative?: boolean

  /** `light` = always OSM (landing/marketing). `auto` = in-app only, dark tiles if user saved dark. */
  mapTileTheme?: MapTileTheme

  overlayMode?: boolean

  sheetSnap?: SheetSnap

  recenterTrigger?: number

  onRetryGeo?: () => void

  geoLoading?: boolean

  geoError?: string

  showLocateControl?: boolean

  /** Desktop split: brand chip in the map chrome row beside geo (not absolute overlap). */
  showBrandBadge?: boolean

  /** Subtle occupied-territory tint (no border stroke or outside dim). */
  showUkraineMask?: boolean

  /** Fit whole Ukraine on load (decorative hero / directory wide view). */
  ukraineMapFitCountry?: boolean

  /** Override map zoom (defaults to 6 for all-ukraine directory, else 13). */
  mapZoom?: number

  /** Directory scope selector — «Вся Україна» vs «Моє місто». */
  directoryScope?: DirectoryScopeMode
  onDirectoryScopeChange?: (scope: DirectoryScopeMode) => void
  directoryScopeCity?: string
  directoryScopeGeoLoading?: boolean
  directoryScopeGeoError?: string
  onDirectoryScopeGeoRetry?: () => void
  directoryScopeRecenterTrigger?: number
  directoryScopeCityCenter?: Point

}



export function RouteMap({

  pickup,

  destination,

  providers,

  providerPosition,

  requestPins,

  subtitle,

  onPick,

  onAcceptRequest,

  onContactRequest,

  onRequestPinSelect,

  onProviderSelect,

  full = false,

  showBadges = true,

  showAllProviders = false,

  showDirectoryProviders = true,

  directoryOnly = false,

  userLocation,

  onUserLocationChange,

  decorative = false,

  mapTileTheme = "light",

  overlayMode = false,

  sheetSnap,

  recenterTrigger = 0,

  onRetryGeo,

  geoLoading = false,

  geoError,

  showLocateControl = true,

  showBrandBadge = false,

  showUkraineMask = false,

  ukraineMapFitCountry,

  mapZoom,

  directoryScope,

  onDirectoryScopeChange,

  directoryScopeCity,

  directoryScopeGeoLoading = false,

  directoryScopeGeoError,

  onDirectoryScopeGeoRetry,

  directoryScopeRecenterTrigger = 0,

  directoryScopeCityCenter,

}: RouteMapProps) {
  const mapInteractive = !decorative
  const locationPickMode = Boolean(onPick) && !destination && !directoryOnly && !providerPosition
  const ukraineWideView =
    !onPick && (directoryOnly || directoryScope === "all-ukraine")
  const effectiveShowOccupiedOverlay = showUkraineMask
  const effectiveZoom = mapZoom ?? (ukraineWideView ? 6 : 13)
  const effectiveCenter: LatLngTuple = ukraineWideView ? [48.5, 31.5] : toTuple(providerPosition ?? userLocation ?? pickup)
  const initialCenterRef = useRef<LatLngTuple>(effectiveCenter)
  const [markerDragging, setMarkerDragging] = useState(false)
  const [occupiedPickHint, setOccupiedPickHint] = useState<string | undefined>()

  const [localGeoLoading, setLocalGeoLoading] = useState(false)

  const [localGeoError, setLocalGeoError] = useState<string | undefined>()

  const [localLocatePoint, setLocalLocatePoint] = useState<LatLngTuple | null>(null)

  const [localLocateTrigger, setLocalLocateTrigger] = useState(0)

  const [categoryFilter, setCategoryFilter] = useState<DirectoryCategoryKey>("all")

  const [directoryMarkersHidden, setDirectoryMarkersHidden] = useState(false)

  const [mapToolsOpen, setMapToolsOpen] = useState(false)

  const [routeCoords, setRouteCoords] = useState<LatLngTuple[] | null>(null)

  const [routeFallback, setRouteFallback] = useState(false)

  const [routeInfo, setRouteInfo] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null)

  const [navRouteCoords, setNavRouteCoords] = useState<LatLngTuple[] | null>(null)

  const [navRouteFallback, setNavRouteFallback] = useState(false)

  const [navRouteInfo, setNavRouteInfo] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null)

  const [navOrigin, setNavOrigin] = useState<Point | null>(null)

  const [navTarget, setNavTarget] = useState<Point | null>(null)

  const [navTargetProviderId, setNavTargetProviderId] = useState<string | null>(null)

  const [navLoading, setNavLoading] = useState(false)

  const [originSheetOpen, setOriginSheetOpen] = useState(false)

  const [originPickMode, setOriginPickMode] = useState(false)

  const [originAddress, setOriginAddress] = useState("")

  const [originGeocoding, setOriginGeocoding] = useState(false)

  const [originGeoRequesting, setOriginGeoRequesting] = useState(false)

  const [originError, setOriginError] = useState<string | undefined>()

  const [pendingNavTarget, setPendingNavTarget] = useState<Point | null>(null)

  const effectiveOrigin = userLocation ?? navOrigin

  const loadNavigationRoute = (from: Point, to: Point) => {
    setNavLoading(true)
    setNavOrigin(from)
    setNavTarget(to)
    setOriginSheetOpen(false)
    setOriginPickMode(false)
    setOriginError(undefined)

    const fallbackLine: LatLngTuple[] = [toTuple(from), toTuple(to)]

    fetchOsrmRoute(from, to)
      .then((result) => {
        if (result) {
          setNavRouteCoords(result.coordinates)
          setNavRouteFallback(false)
          setNavRouteInfo({ distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds })
        } else {
          setNavRouteCoords(fallbackLine)
          setNavRouteFallback(true)
          setNavRouteInfo(null)
        }
      })
      .catch(() => {
        setNavRouteCoords(fallbackLine)
        setNavRouteFallback(true)
        setNavRouteInfo(null)
      })
      .finally(() => {
        setNavLoading(false)
      })
  }

  const clearNavigationRoute = () => {
    setNavRouteCoords(null)
    setNavRouteFallback(false)
    setNavRouteInfo(null)
    setNavOrigin(null)
    setNavTarget(null)
    setNavTargetProviderId(null)
    setPendingNavTarget(null)
    setOriginSheetOpen(false)
    setOriginPickMode(false)
    setOriginError(undefined)
  }

  const resolveOriginAndNavigate = (target: Point, providerId: string) => {
    if (navTargetProviderId === providerId && navRouteCoords) {
      clearNavigationRoute()
      return
    }

    setPendingNavTarget(target)
    setNavTargetProviderId(providerId)

    if (effectiveOrigin) {
      loadNavigationRoute(effectiveOrigin, target)
      return
    }

    if (typeof navigator !== "undefined" && "geolocation" in navigator) {
      setOriginGeoRequesting(true)
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const point = { lat: position.coords.latitude, lng: position.coords.longitude }
          onUserLocationChange?.(point)
          setOriginGeoRequesting(false)
          loadNavigationRoute(point, target)
        },
        () => {
          setOriginGeoRequesting(false)
          setOriginSheetOpen(true)
        },
        { enableHighAccuracy: true, timeout: 10000 },
      )
      return
    }

    setOriginSheetOpen(true)
  }

  const handleProviderRoute = (item: ProviderAvailability) => {
    const target = providerPoint(item)
    if (!target) return
    resolveOriginAndNavigate(target, item.id)
  }

  const handleSubmitOriginAddress = async () => {
    setOriginGeocoding(true)
    setOriginError(undefined)
    const point = await forwardGeocodeAddress(originAddress)
    setOriginGeocoding(false)
    if (!point) {
      setOriginError("Адресу не знайдено. Спробуйте інший запит або оберіть точку на карті.")
      return
    }
    if (pendingNavTarget) {
      loadNavigationRoute(point, pendingNavTarget)
    }
  }

  const handleRequestOriginGeo = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setOriginError("Геолокація недоступна у цьому браузері.")
      return
    }
    setOriginGeoRequesting(true)
    setOriginError(undefined)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        onUserLocationChange?.(point)
        setOriginGeoRequesting(false)
        if (pendingNavTarget) {
          loadNavigationRoute(point, pendingNavTarget)
        }
      },
      () => {
        setOriginGeoRequesting(false)
        setOriginError("Не вдалося отримати геолокацію. Дозвольте доступ або вкажіть адресу вручну.")
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleMapPick = (point: Point) => {
    if (isOccupiedCoordinates(point.lat, point.lng)) {
      setOccupiedPickHint(OCCUPIED_PICK_MESSAGE)
      return
    }
    setOccupiedPickHint(undefined)
    if (originPickMode && pendingNavTarget) {
      loadNavigationRoute(point, pendingNavTarget)
      return
    }
    onPick?.(point)
  }



  const routeEndpoints = useMemo(() => {

    if (directoryOnly) return null

    if (providerPosition) return { from: providerPosition, to: pickup }

    if (destination) return { from: pickup, to: destination }

    return null

  }, [destination, directoryOnly, pickup, providerPosition])



  useEffect(() => {

    if (!routeEndpoints) {

      setRouteCoords(null)

      setRouteFallback(false)

      setRouteInfo(null)

      return

    }



    let cancelled = false

    const { from, to } = routeEndpoints

    const fallbackLine: LatLngTuple[] = [toTuple(from), toTuple(to)]



    fetchOsrmRoute(from, to)

      .then((result) => {

        if (cancelled) return

        if (result) {

          setRouteCoords(result.coordinates)

          setRouteFallback(false)

          setRouteInfo({ distanceMeters: result.distanceMeters, durationSeconds: result.durationSeconds })

        } else {

          setRouteCoords(fallbackLine)

          setRouteFallback(true)

          setRouteInfo(null)

        }

      })

      .catch(() => {

        if (cancelled) return

        setRouteCoords(fallbackLine)

        setRouteFallback(true)

        setRouteInfo(null)

      })



    return () => {

      cancelled = true

    }

  }, [routeEndpoints])



  const center = providerPosition ? toTuple(providerPosition) : userLocation ? toTuple(userLocation) : toTuple(pickup)
  const followMapCenter =
    !decorative &&
    !destination &&
    !providerPosition &&
    !directoryOnly &&
    !markerDragging &&
    !navRouteCoords &&
    !locationPickMode &&
    !ukraineWideView



  const { directoryProviders, liveProviders } = useMemo(() => {

    const items = providers ?? []

    const directory = showDirectoryProviders

      ? items.filter((item) => isDirectoryMapProvider(item) && providerPoint(item))

      : []

    const live = showAllProviders

      ? items.filter((item) => item.providerKind !== "directory" && providerPoint(item))

      : items.filter((item) => item.providerKind !== "directory" && isProviderAvailable(item))

    return { directoryProviders: directory, liveProviders: live }

  }, [providers, showAllProviders, showDirectoryProviders])



  const filteredDirectoryProviders = useMemo(() => {
    if (directoryMarkersHidden) return []

    if (categoryFilter === "all") return directoryProviders

    return directoryProviders.filter((item) => getDirectoryPrimarySpecialty(item) === categoryFilter)
  }, [categoryFilter, directoryMarkersHidden, directoryProviders])



  const categoryCounts = useMemo(() => {

    const counts: Record<string, number> = { all: directoryProviders.length }

    for (const item of directoryProviders) {

      const key = getDirectoryPrimarySpecialty(item)

      counts[key] = (counts[key] ?? 0) + 1

    }

    return counts

  }, [directoryProviders])



  const hideMapChrome = sheetSnap === "expanded"

  /* Scope selector must stay available even when the directory list is empty. */
  const showDirectoryScopeTools = Boolean(onDirectoryScopeChange)
  const showMapTools =
    showBadges && !hideMapChrome && (directoryProviders.length > 0 || showDirectoryScopeTools)

  const locateLoading = geoLoading || localGeoLoading
  /* Sheet already shows parent geoError on overlay rides — avoid duplicate banners. */
  const locateError = localGeoError || (overlayMode ? undefined : geoError)
  const showLocate = showLocateControl && mapInteractive && !hideMapChrome
  const showMapChromeRow = (showLocate || showBrandBadge) && !hideMapChrome

  const handleLocateClick = () => {
    setLocalGeoError(undefined)
    if (onRetryGeo) {
      onRetryGeo()
      // Also resolve locally so flyTo+sheet padding runs even if parent state is slow.
    }
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      if (!onRetryGeo) setLocalGeoError("Геолокація недоступна у цьому браузері.")
      return
    }
    setLocalGeoLoading(true)
    requestCurrentPosition(
      (point) => {
        const tuple: LatLngTuple = [point.lat, point.lng]
        setLocalGeoLoading(false)
        setLocalLocatePoint(tuple)
        setLocalLocateTrigger((value) => value + 1)
        onUserLocationChange?.(point)
        if (locationPickMode) {
          if (isOccupiedCoordinates(point.lat, point.lng)) {
            setOccupiedPickHint(OCCUPIED_PICK_MESSAGE)
          } else {
            setOccupiedPickHint(undefined)
            onPick?.(point)
          }
        }
      },
      (message) => {
        setLocalGeoLoading(false)
        if (!onRetryGeo) setLocalGeoError(message)
      },
    )
  }

  
  const routeLabel = routeInfo

    ? `${formatRouteDistance(routeInfo.distanceMeters)} · ${formatRouteDuration(routeInfo.durationSeconds)}`

    : routeFallback && routeEndpoints

      ? "Маршрут орієнтовний"

      : null

  const navRouteLabel = navRouteInfo

    ? `${formatRouteDistance(navRouteInfo.distanceMeters)} · ${formatRouteDuration(navRouteInfo.durationSeconds)}`

    : navRouteFallback && navRouteCoords

      ? "Маршрут орієнтовний"

      : null

  const activeRouteLabel = navRouteLabel ?? routeLabel

  const displaySubtitle = subtitle

    ? activeRouteLabel

      ? `${subtitle} · ${activeRouteLabel}`

      : subtitle

    : activeRouteLabel ?? undefined



  return (

    <div className={`pomich-route-map${full ? " pomich-route-map--full" : ""}${ukraineWideView ? " pomich-route-map--ukraine-wide" : ""}`} style={{ height: full ? "100%" : 244, minHeight: full ? 0 : undefined, borderRadius: full ? 0 : 22, overflow: full ? "visible" : "hidden", border: full ? "none" : `1px solid ${BORDER}`, position: "relative", ...(decorative ? { pointerEvents: "none" } : {}) }}>

      <MapContainer center={initialCenterRef.current} zoom={effectiveZoom} zoomControl={mapInteractive} scrollWheelZoom={mapInteractive} dragging={mapInteractive} touchZoom={mapInteractive} doubleClickZoom={mapInteractive} boxZoom={mapInteractive} keyboard={mapInteractive} style={{ width: "100%", height: "100%" }}>

        <MapSizeController />

        {directoryScopeRecenterTrigger > 0 && directoryScope ? (
          <MapDirectoryScopeRecenter
            scope={directoryScope}
            cityCenter={directoryScopeCityCenter}
            trigger={directoryScopeRecenterTrigger}
            compact={overlayMode}
          />
        ) : null}
        {recenterTrigger > 0 && !ukraineWideView ? (
          <MapExplicitRecenter point={center} trigger={recenterTrigger} sheetSnap={sheetSnap} overlayMode={overlayMode} />
        ) : null}
        {localLocateTrigger > 0 && localLocatePoint ? (
          <MapLocateFlyTo point={localLocatePoint} trigger={localLocateTrigger} sheetSnap={sheetSnap} overlayMode={overlayMode} />
        ) : null}
        {followMapCenter ? (
          <MapDebouncedFollow
            point={center}
            enabled={followMapCenter}
            recenterTrigger={recenterTrigger}
            sheetSnap={sheetSnap}
            overlayMode={overlayMode}
          />
        ) : null}
        {(followMapCenter || (recenterTrigger > 0 && !ukraineWideView) || localLocateTrigger > 0) && (overlayMode || sheetSnap) ? (
          <MapKeepVisibleAboveSheet
            point={localLocatePoint ?? center}
            sheetSnap={sheetSnap}
            overlayMode={overlayMode}
            active
          />
        ) : null}

        {decorative ? <DisableMapInteractions /> : mapInteractive ? <MapPointerScrollZoom /> : null}

        <MapThemeTileLayer mapTileTheme={mapTileTheme} />

        <UkraineMapLayers
          enabled={effectiveShowOccupiedOverlay}
          fitCountry={ukraineMapFitCountry ?? (decorative || directoryScope === "all-ukraine")}
        />

        {mapInteractive ? <ClickToPick onPick={handleMapPick} /> : null}

        {navRouteCoords ? <FitRouteBounds coords={navRouteCoords} /> : null}

        {!directoryOnly && routeCoords ? (

          <Polyline

            positions={routeCoords}

            pathOptions={{

              color: BRAND,

              weight: 5,

              opacity: routeFallback ? 0.45 : 0.82,

              dashArray: routeFallback ? "10 8" : undefined,

            }}

          />

        ) : null}

        {navRouteCoords ? (

          <Polyline

            positions={navRouteCoords}

            pathOptions={{

              color: "#2563EB",

              weight: 5,

              opacity: navRouteFallback ? 0.45 : 0.88,

              dashArray: navRouteFallback ? "10 8" : undefined,

            }}

          />

        ) : null}

        {!directoryOnly ? (

          <Marker
            position={toTuple(pickup)}
            icon={pickupIcon}
            draggable={locationPickMode}
            eventHandlers={
              locationPickMode
                ? {
                    dragstart: () => {
                      setMarkerDragging(true)
                    },
                    dragend: (event) => {
                      const position = event.target.getLatLng()
                      const point = { lat: position.lat, lng: position.lng }
                      if (isOccupiedCoordinates(point.lat, point.lng)) {
                        setOccupiedPickHint(OCCUPIED_PICK_MESSAGE)
                        setMarkerDragging(false)
                        return
                      }
                      setOccupiedPickHint(undefined)
                      onPick?.(point)
                      setMarkerDragging(false)
                    },
                  }
                : undefined
            }
          >

            <Popup>{locationPickMode ? "Перетягніть маркер або натисніть на карту" : "Клієнт · місце подачі"}</Popup>

          </Marker>

        ) : null}

        {filteredDirectoryProviders.length > 0 ? (
          <DirectoryProviderMarkers
            providers={filteredDirectoryProviders}
            userLocation={userLocation}
            pickup={pickup}
            onProviderSelect={onProviderSelect}
            onRoute={handleProviderRoute}
            navLoading={navLoading}
            navTargetProviderId={navTargetProviderId}
            navRouteCoords={navRouteCoords}
            navRouteLabel={navRouteLabel}
          />
        ) : null}

        {!directoryOnly

          ? liveProviders.map((item) => {

              const point = providerPoint(item)

              return point ? (

                <Marker
                  key={item.id}
                  position={toTuple(point)}
                  icon={liveProviderIcon}
                  eventHandlers={
                    onProviderSelect
                      ? {
                          click: () => {
                            const distanceKm = distanceToProvider(userLocation ?? pickup, item)
                            onProviderSelect({
                              ...item,
                              distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(1)) : undefined,
                              etaMinutes: item.etaMinutes ?? (Number.isFinite(distanceKm) ? Math.max(5, Math.ceil(distanceKm * 4)) : undefined),
                            })
                          },
                        }
                      : undefined
                  }
                >
                  {onProviderSelect ? null : (
                    <Popup>
                      <LivePartnerPopup item={item} />
                    </Popup>
                  )}
                </Marker>

              ) : null

            })

          : null}

        {!directoryOnly

          ? (requestPins ?? []).map((pin) => {

              const point = pin.customerCoordinates

              if (!point) return null

              return (

                <Marker
                  key={pin.offerId ?? pin.id}
                  position={toTuple(point)}
                  icon={requestIcon}
                  zIndexOffset={1200}
                  eventHandlers={{
                    click: () => {
                      onRequestPinSelect?.(pin)
                    },
                  }}
                >

                  <Popup>

                    <div style={{ minWidth: 200, maxWidth: 260 }}>

                      <strong>{getProviderCapabilityLabel(pin.service)}</strong>

                      <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.35, overflowWrap: "anywhere" }}>{pin.customerLocation ?? "Поруч"}</div>

                      {pin.vehicleState ? <div style={{ marginTop: 4, fontSize: 12 }}>{pin.vehicleState}</div> : null}

                      {pin.customerComment ? <div style={{ marginTop: 6, fontSize: 12, fontStyle: "italic", lineHeight: 1.35 }}>{pin.customerComment}</div> : null}

                      {typeof pin.distanceKm === "number" ? <div style={{ marginTop: 4, fontSize: 12 }}>{pin.distanceKm.toFixed(1)} км · ~{pin.etaMinutes ?? Math.ceil(pin.distanceKm * 4)} хв</div> : null}

                      {onRequestPinSelect ? (
                        <button type="button" onClick={() => onRequestPinSelect(pin)} style={{ width: "100%", marginTop: 10, border: "none", borderRadius: 10, background: BRAND, color: "#fff", padding: "8px 10px", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                          Деталі заявки
                        </button>
                      ) : null}

                      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>

                        {pin.offerId && onAcceptRequest && !onRequestPinSelect ? (

                          <button type="button" onClick={() => onAcceptRequest(pin)} style={{ border: "none", borderRadius: 10, background: BRAND, color: "#fff", padding: "8px 10px", fontWeight: 800, cursor: "pointer" }}>

                            Прийняти заявку

                          </button>

                        ) : null}

                        {onContactRequest ? (

                          <button type="button" onClick={() => onContactRequest(pin)} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, background: "#fff", color: DARK, padding: "8px 10px", fontWeight: 800, cursor: "pointer" }}>

                            Зв&apos;язатися

                          </button>

                        ) : null}

                      </div>

                    </div>

                  </Popup>

                </Marker>

              )

            })

          : null}

        {!directoryOnly && destination ? (

          <Marker position={toTuple(destination)} icon={destinationIcon}>

            <Popup>Пункт призначення</Popup>

          </Marker>

        ) : null}

        {!directoryOnly && providerPosition ? (

          <Marker position={toTuple(providerPosition)} icon={partnerIcon}>

            <Popup>{provider.name} · партнер у дорозі</Popup>

          </Marker>

        ) : null}

        {navOrigin && !userLocation ? (

          <Marker position={toTuple(navOrigin)} icon={pickupIcon}>

            <Popup>Старт маршруту</Popup>

          </Marker>

        ) : null}

        {userLocation && !locationPickMode ? (

          <Marker position={toTuple(userLocation)} icon={userLocationIcon}>

            <Popup>Ваше місцезнаходження</Popup>

          </Marker>

        ) : null}

      </MapContainer>

      {originSheetOpen ? (
        <RouteOriginSheet
          address={originAddress}
          geocoding={originGeocoding}
          geoRequesting={originGeoRequesting}
          pickMode={originPickMode}
          error={originError}
          onAddressChange={setOriginAddress}
          onSubmitAddress={handleSubmitOriginAddress}
          onRequestGeo={handleRequestOriginGeo}
          onPickOnMap={() => {
            setOriginPickMode((value) => !value)
            setOriginError(undefined)
          }}
          onClose={() => {
            setOriginSheetOpen(false)
            setOriginPickMode(false)
            setOriginError(undefined)
          }}
        />
      ) : null}

      {showBadges && displaySubtitle && !hideMapChrome ? (
        <div className="pomich-map-address-pill">
          {displaySubtitle}
        </div>
      ) : null}

      {showMapChromeRow ? (
        <div className="pomich-map-chrome-row">
          {showLocate ? (
            <button
              type="button"
              className={`pomich-map-locate__btn${locateLoading ? " is-loading" : ""}${locateError ? " is-error" : ""}`}
              aria-label="Моє місцезнаходження"
              title="Моє місцезнаходження"
              onClick={handleLocateClick}
              disabled={locateLoading}
            >
              <LocateCrosshairIcon spinning={locateLoading} />
            </button>
          ) : null}
          {showBrandBadge ? (
            <div className="pomich-map-chip pomich-map-chip--brand pomich-map-chrome-row__brand px-3 py-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
              POMICH
            </div>
          ) : null}
          {showLocate && locateError ? (
            <div className="pomich-map-locate__hint" role="status">
              {locateError}
            </div>
          ) : showLocate && locateLoading ? (
            <div
              className="pomich-map-locate__hint pomich-map-locate__hint--muted"
              role="status"
              aria-label="Визначаємо місцезнаходження…"
            >
              <span className="pomich-map-locate__hint-full">Визначаємо місцезнаходження…</span>
              <span className="pomich-map-locate__hint-short" aria-hidden="true">Визначаємо…</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {showMapTools ? (
        mapToolsOpen ? (
          <div className="pomich-map-tools-panel" role="dialog" aria-label="Допомога поруч">
            <div className="pomich-map-tools-panel__head">
              <div>
                <div className="pomich-map-tools-panel__brand">Допомога поруч</div>
              </div>
              <button
                type="button"
                className="pomich-map-tools-panel__close"
                aria-label="Закрити фільтр сервісів"
                onClick={() => setMapToolsOpen(false)}
              >
                ✕
              </button>
            </div>
            {onDirectoryScopeChange ? (
              <>
                <div className="pomich-map-tools-panel__title">Регіон</div>
                <div className="pomich-map-tools-scope-row">
                  <button
                    type="button"
                    className={`pomich-map-tools-scope-btn${directoryScope === "all-ukraine" ? " is-active" : ""}`}
                    onClick={() => onDirectoryScopeChange("all-ukraine")}
                    aria-pressed={directoryScope === "all-ukraine"}
                  >
                    <span className="pomich-flag-ua" aria-hidden="true" />
                    Вся Україна
                  </button>
                  <button
                    type="button"
                    className={`pomich-map-tools-scope-btn${directoryScope === "my-city" ? " is-active" : ""}`}
                    onClick={() => onDirectoryScopeChange("my-city")}
                    aria-pressed={directoryScope === "my-city"}
                    disabled={directoryScopeGeoLoading}
                  >
                    {directoryScopeGeoLoading ? "📍 …" : "📍 Моє місто"}
                  </button>
                </div>
                {directoryScope === "my-city" && directoryScopeCity ? (
                  <div className="pomich-map-tools-scope-hint" role="status">
                    Показано: {directoryScopeCity}
                  </div>
                ) : null}
                {directoryScopeGeoError ? (
                  <div className="pomich-map-tools-scope-error" role="alert">
                    {directoryScopeGeoError}
                    {onDirectoryScopeGeoRetry ? (
                      <button type="button" className="pomich-map-tools-scope-retry" onClick={onDirectoryScopeGeoRetry}>
                        Спробувати знову
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="pomich-map-tools-panel__title">{onDirectoryScopeChange ? "Категорії" : "Фільтр сервісів"}</div>
            {directoryProviders.length > 0 ? (
              <button
                type="button"
                className={`pomich-map-tools-filter-btn pomich-map-tools-filter-btn--toggle${directoryMarkersHidden ? " is-active" : ""}`}
                onClick={() => {
                  if (directoryMarkersHidden) {
                    setDirectoryMarkersHidden(false)
                    setCategoryFilter("all")
                    return
                  }
                  setDirectoryMarkersHidden(true)
                }}
                aria-pressed={directoryMarkersHidden}
              >
                {directoryMarkersHidden ? "👁 Показати всі" : "Сховати все"}
              </button>
            ) : null}
            {directoryCategoryFilters.map((filter) => {
              const count = categoryCounts[filter.key] ?? 0
              if (filter.key !== "all" && count === 0) return null
              const active = !directoryMarkersHidden && categoryFilter === filter.key
              return (
                <button
                  key={filter.key}
                  type="button"
                  className="pomich-map-tools-filter-btn"
                  onClick={() => {
                    setDirectoryMarkersHidden(false)
                    setCategoryFilter(filter.key)
                  }}
                  style={{
                    borderColor: active ? filter.color : undefined,
                    background: active ? `${filter.color}18` : undefined,
                    fontWeight: active ? 900 : 700,
                    opacity: directoryMarkersHidden ? 0.55 : 1,
                  }}
                >
                  {filter.emoji} {filter.label}{count > 0 ? ` (${count})` : ""}
                </button>
              )
            })}
            <div className="pomich-map-tools-panel__title">Легенда</div>
            {directoryOnly ? (
              <>
                <span className="pomich-map-tools-legend-item">🔧 Сервіс / СТО</span>
                <span className="pomich-map-tools-legend-item">🟣 Ваше місце</span>
                <span className="pomich-map-tools-legend-item">🔵 Маршрут</span>
                {effectiveShowOccupiedOverlay ? <span className="pomich-map-tools-legend-item">🟥 Тимчасово окуповано</span> : null}
              </>
            ) : (
              <>
                <span className="pomich-map-tools-legend-item">🟢 Клієнт</span>
                {providerPosition ? <span className="pomich-map-tools-legend-item">🟠 Партнер</span> : <span className="pomich-map-tools-legend-item">🚛 Партнер на лінії</span>}
                {destination ? <span className="pomich-map-tools-legend-item">🔵 Пункт призначення</span> : null}
                <span className="pomich-map-tools-legend-item">🔧 Сервіс</span>
                <span className="pomich-map-tools-legend-item">🔴 Заявка</span>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="pomich-map-tools-toggle"
            aria-expanded={false}
            aria-label="Допомога поруч — фільтр сервісів"
            onClick={() => setMapToolsOpen(true)}
          >
            Допомога поруч
          </button>
        )
      ) : showBadges && !hideMapChrome && directoryProviders.length === 0 && !showDirectoryScopeTools ? (
        <MapLegend directoryOnly={directoryOnly} hasDestination={Boolean(destination)} hasPartner={Boolean(providerPosition)} overlayMode={overlayMode} />
      ) : null}

      {occupiedPickHint ? (
        <div
          className={`pomich-map-occupied-hint${overlayMode ? " pomich-map-occupied-hint--overlay" : ""}`}
          role="status"
        >
          {occupiedPickHint}
        </div>
      ) : null}

    </div>

  )

}



export default RouteMap

