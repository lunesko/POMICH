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

  providerStatusLabel,

  toServiceKeys,

  toTuple,

  type DirectoryCategoryKey,

  type Point,

} from "../../lib/constants"

import { fetchOsrmRoute, formatRouteDistance, formatRouteDuration, forwardGeocodeAddress } from "../../lib/osrmRoute"

import ClickToPick from "./ClickToPick"

import MapSizeController from "./MapSizeController"

import {
  MAP_GEO_DEBOUNCE_MS,
  MAP_RECENTER_THRESHOLD_M,
  moveMapToPoint,
  shouldRecenterMap,
} from "../../lib/mapGeo"

import type { SheetSnap } from "../../hooks/useMobileSheetSnap"



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

function FitRouteBounds({ coords }: { coords: LatLngTuple[] }) {
  const map = useMap()
  useEffect(() => {
    if (coords.length < 2) return
    map.fitBounds(L.latLngBounds(coords), { padding: [52, 52] })
  }, [coords, map])
  return null
}

function MapExplicitRecenter({ point, trigger }: { point: LatLngTuple; trigger: number }) {
  const map = useMap()
  const pointRef = useRef(point)
  const lastTriggerRef = useRef(0)

  pointRef.current = point

  useEffect(() => {
    if (trigger <= 0 || trigger === lastTriggerRef.current) return
    lastTriggerRef.current = trigger
    moveMapToPoint(map, pointRef.current, { animateLarge: true })
  }, [trigger, map])

  return null
}

function MapDebouncedFollow({
  point,
  enabled,
  recenterTrigger = 0,
}: {
  point: LatLngTuple
  enabled: boolean
  recenterTrigger?: number
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

      moveMapToPoint(map, point, { animateLarge: false })
      lastCenterRef.current = point
    }, MAP_GEO_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [enabled, map, point])

  return null
}



const pickupIcon = L.divIcon({

  className: "pomich-pickup-marker",

  html: '<div style="width:24px;height:24px;border-radius:999px;background:#16A36A;border:3px solid white;box-shadow:0 8px 24px rgba(0,0,0,0.22)"></div>',

  iconSize: [24, 24],

  iconAnchor: [12, 12],

})



const destinationIcon = L.divIcon({

  className: "pomich-destination-marker",

  html: '<div style="width:24px;height:24px;border-radius:999px;background:#2563EB;border:3px solid white;box-shadow:0 8px 24px rgba(0,0,0,0.22)"></div>',

  iconSize: [24, 24],

  iconAnchor: [12, 12],

})



const partnerIcon = L.divIcon({

  className: "pomich-partner-marker",

  html: '<div style="width:28px;height:28px;border-radius:999px;background:#F59E0B;border:3px solid white;box-shadow:0 8px 24px rgba(245,158,11,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:13px">🚛</div>',

  iconSize: [28, 28],

  iconAnchor: [14, 14],

})



const liveProviderIcon = L.divIcon({

  className: "pomich-live-provider-marker",

  html: '<div style="width:28px;height:28px;border-radius:999px;background:#111315;border:3px solid white;box-shadow:0 8px 24px rgba(0,0,0,0.24);display:flex;align-items:center;justify-content:center;color:white;font-size:13px">🚛</div>',

  iconSize: [28, 28],

  iconAnchor: [14, 14],

})



const userLocationIcon = L.divIcon({

  className: "pomich-user-location-marker",

  html: '<div style="width:20px;height:20px;border-radius:999px;background:#6366F1;border:3px solid white;box-shadow:0 8px 24px rgba(99,102,241,0.35)"></div>',

  iconSize: [20, 20],

  iconAnchor: [10, 10],

})



const requestIcon = L.divIcon({

  className: "pomich-request-marker",

  html: '<div style="width:30px;height:30px;border-radius:999px;background:#EF4444;border:3px solid white;box-shadow:0 8px 24px rgba(239,68,68,0.35);display:flex;align-items:center;justify-content:center;color:white;font-size:14px">!</div>',

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

    html: `<div style="width:26px;height:26px;border-radius:8px;background:${color};border:2px solid white;box-shadow:0 8px 24px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;color:white;font-size:12px">${emoji}</div>`,

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
          background: "#fff",
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
            placeholder="Напр. вул. Швабська, Ужгород"
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
              background: "#fff",
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



function MapLegend({ directoryOnly, hasDestination, hasPartner, overlayMode }: { directoryOnly?: boolean; hasDestination?: boolean; hasPartner?: boolean; overlayMode?: boolean }) {

  const chromeStyle = { position: "absolute" as const, zIndex: 1100, right: 12, top: overlayMode ? 8 : 12, background: "rgba(255,255,255,0.96)", borderRadius: 12, padding: "7px 10px", fontSize: 10, fontWeight: 900, color: DARK, boxShadow: "0 4px 14px rgba(0,0,0,0.08)", display: "grid", gap: 4 }

  if (directoryOnly) {

    return (

      <div style={chromeStyle}>

        <span style={{ marginBottom: 2, fontSize: 9, color: "#6B7280" }}>Легенда</span>

        <span>🔧 Сервіс / СТО</span>

        <span>🟣 Ваше місце</span>

        <span>🔵 Маршрут</span>

      </div>

    )

  }



  return (

    <div style={chromeStyle}>

      <span style={{ marginBottom: 2, fontSize: 9, color: "#6B7280" }}>Легенда</span>

      <span>🟢 Клієнт</span>

      {hasPartner ? <span>🟠 Партнер</span> : <span>🚛 Партнер на лінії</span>}

      {hasDestination ? <span>🔵 Пункт призначення</span> : null}

      <span>🔧 Сервіс</span>

      <span>🔴 Заявка</span>

    </div>

  )

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

  full?: boolean

  showBadges?: boolean

  showAllProviders?: boolean

  directoryOnly?: boolean

  userLocation?: Point

  onUserLocationChange?: (point: Point) => void

  decorative?: boolean

  overlayMode?: boolean

  sheetSnap?: SheetSnap

  recenterTrigger?: number

  onRetryGeo?: () => void

  geoLoading?: boolean

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

  full = false,

  showBadges = true,

  showAllProviders = false,

  directoryOnly = false,

  userLocation,

  onUserLocationChange,

  decorative = false,

  overlayMode = false,

  sheetSnap,

  recenterTrigger = 0,

  onRetryGeo,

  geoLoading = false,

}: RouteMapProps) {
  const mapInteractive = !decorative
  const locationPickMode = Boolean(onPick) && !destination && !directoryOnly && !providerPosition
  const initialCenterRef = useRef<LatLngTuple>(toTuple(providerPosition ?? userLocation ?? pickup))
  const [markerDragging, setMarkerDragging] = useState(false)

  const [categoryFilter, setCategoryFilter] = useState<DirectoryCategoryKey>("all")

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
  const followMapCenter = !decorative && !destination && !providerPosition && !directoryOnly && !markerDragging && !navRouteCoords && !locationPickMode



  const { directoryProviders, liveProviders } = useMemo(() => {

    const items = providers ?? []

    const directory = items.filter((item) => item.providerKind === "directory" && providerPoint(item))

    const live = showAllProviders

      ? items.filter((item) => item.providerKind !== "directory" && providerPoint(item))

      : items.filter((item) => item.providerKind !== "directory" && isProviderAvailable(item))

    return { directoryProviders: directory, liveProviders: live }

  }, [providers, showAllProviders])



  const filteredDirectoryProviders = useMemo(() => {

    if (categoryFilter === "all") return directoryProviders

    return directoryProviders.filter((item) => getDirectoryPrimarySpecialty(item) === categoryFilter)

  }, [categoryFilter, directoryProviders])



  const categoryCounts = useMemo(() => {

    const counts: Record<string, number> = { all: directoryProviders.length }

    for (const item of directoryProviders) {

      const key = getDirectoryPrimarySpecialty(item)

      counts[key] = (counts[key] ?? 0) + 1

    }

    return counts

  }, [directoryProviders])



  const overlayBottom = sheetSnap === "collapsed" ? "22%" : sheetSnap === "half" ? "56%" : sheetSnap === "expanded" ? "90%" : overlayMode ? 56 : 12

  const hideMapChrome = sheetSnap === "expanded"

  const compactMapTools = overlayMode && !hideMapChrome



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

    <div className={`pomich-route-map${full ? " pomich-route-map--full" : ""}`} style={{ height: full ? "100%" : 244, minHeight: full ? 0 : undefined, borderRadius: full ? 0 : 22, overflow: "hidden", border: full ? "none" : `1px solid ${BORDER}`, position: "relative", background: "#EAF4EE", ...(decorative ? { pointerEvents: "none" } : {}) }}>

      <MapContainer center={initialCenterRef.current} zoom={13} zoomControl={mapInteractive} scrollWheelZoom={mapInteractive} dragging={mapInteractive} touchZoom={mapInteractive} doubleClickZoom={mapInteractive} boxZoom={mapInteractive} keyboard={mapInteractive} style={{ width: "100%", height: "100%" }}>

        <MapSizeController />

        {recenterTrigger > 0 ? <MapExplicitRecenter point={center} trigger={recenterTrigger} /> : null}
        {followMapCenter ? <MapDebouncedFollow point={center} enabled={followMapCenter} recenterTrigger={recenterTrigger} /> : null}

        {decorative ? <DisableMapInteractions /> : mapInteractive ? <MapPointerScrollZoom /> : null}

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />

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
                      onPick?.({ lat: position.lat, lng: position.lng })
                      setMarkerDragging(false)
                    },
                  }
                : undefined
            }
          >

            <Popup>{locationPickMode ? "Перетягніть маркер або натисніть на карту" : "Клієнт · місце подачі"}</Popup>

          </Marker>

        ) : null}

        {filteredDirectoryProviders.map((item) => {

          const point = providerPoint(item)

          return point ? (

            <Marker key={item.id} position={toTuple(point)} icon={directoryProviderIcon(item)}>

              <Popup>

                <DirectoryPopup
                  item={item}
                  onRoute={() => handleProviderRoute(item)}
                  routeLoading={navLoading && navTargetProviderId === item.id}
                  routeActive={navTargetProviderId === item.id && Boolean(navRouteCoords)}
                  routeLabel={navTargetProviderId === item.id ? navRouteLabel : null}
                />

              </Popup>

            </Marker>

          ) : null

        })}

        {!directoryOnly

          ? liveProviders.map((item) => {

              const point = providerPoint(item)

              return point ? (

                <Marker key={item.id} position={toTuple(point)} icon={liveProviderIcon}>

                  <Popup>

                    <LivePartnerPopup item={item} />

                  </Popup>

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

        <div style={{ position: "absolute", zIndex: 1100, left: 12, bottom: typeof overlayBottom === "string" ? overlayBottom : onRetryGeo ? (overlayMode ? 96 : 52) : overlayMode ? 56 : 12, background: "rgba(255,255,255,0.94)", borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 800, color: DARK, maxWidth: onRetryGeo ? "calc(100% - 170px)" : "calc(100% - 24px)", pointerEvents: "none" }}>

          {displaySubtitle}

        </div>

      ) : null}

      {onRetryGeo && !hideMapChrome ? (
        <button
          type="button"
          aria-label="Оновити геолокацію"
          onClick={onRetryGeo}
          disabled={geoLoading}
          style={{
            position: "absolute",
            zIndex: 1100,
            right: 12,
            bottom: typeof overlayBottom === "string" ? overlayBottom : overlayMode ? 56 : 12,
            border: `1px solid ${BORDER}`,
            borderRadius: 999,
            background: geoLoading ? "rgba(243,244,246,0.96)" : "rgba(255,255,255,0.96)",
            color: geoLoading ? "#9CA3AF" : DARK,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 900,
            cursor: geoLoading ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
            touchAction: "manipulation",
          }}
        >
          <span aria-hidden="true">{geoLoading ? "…" : "↻"}</span>
          {geoLoading ? "Оновлюємо…" : "Оновити геолокацію"}
        </button>
      ) : null}

      {showBadges && directoryProviders.length > 0 && compactMapTools ? (
        <>
          <button
            type="button"
            className="pomich-map-tools-toggle"
            aria-expanded={mapToolsOpen}
            aria-label="Фільтр і легенда карти"
            onClick={() => setMapToolsOpen((value) => !value)}
          >
            {mapToolsOpen ? "✕ Закрити" : "🗺️ Карта"}
          </button>
          {mapToolsOpen ? (
            <div className="pomich-map-tools-panel">
              <div className="pomich-map-tools-panel__title">Фільтр сервісів</div>
              {directoryCategoryFilters.map((filter) => {
                const count = categoryCounts[filter.key] ?? 0
                if (filter.key !== "all" && count === 0) return null
                const active = categoryFilter === filter.key
                return (
                  <button
                    key={filter.key}
                    type="button"
                    className="pomich-map-tools-filter-btn"
                    onClick={() => setCategoryFilter(filter.key)}
                    style={{
                      borderColor: active ? filter.color : undefined,
                      background: active ? `${filter.color}18` : undefined,
                      fontWeight: active ? 900 : 700,
                    }}
                  >
                    {filter.emoji} {filter.label}{count > 0 ? ` (${count})` : ""}
                  </button>
                )
              })}
              <div className="pomich-map-tools-panel__title">Легенда</div>
              {directoryOnly ? (
                <>
                  <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🔧 Сервіс / СТО</span>
                  <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🟣 Ваше місце</span>
                  <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🔵 Маршрут</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🟢 Клієнт</span>
                  {providerPosition ? <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🟠 Партнер</span> : <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🚛 Партнер на лінії</span>}
                  {destination ? <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🔵 Пункт призначення</span> : null}
                  <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🔧 Сервіс</span>
                  <span style={{ fontSize: 10, fontWeight: 900, color: DARK }}>🔴 Заявка</span>
                </>
              )}
            </div>
          ) : null}
        </>
      ) : showBadges && directoryProviders.length > 0 ? (

        <div style={{ position: "absolute", zIndex: 1100, right: 12, top: overlayMode ? 8 : 12, background: "rgba(255,255,255,0.96)", borderRadius: 12, padding: "8px 10px", fontSize: 10, fontWeight: 900, color: DARK, boxShadow: "0 4px 14px rgba(0,0,0,0.08)", display: "grid", gap: 4, maxWidth: 150, maxHeight: overlayMode ? "38%" : undefined, overflowY: overlayMode ? "auto" : undefined }}>

          <span style={{ marginBottom: 2, fontSize: 9, color: "#6B7280" }}>Фільтр сервісів</span>

          {directoryCategoryFilters.map((filter) => {

            const count = categoryCounts[filter.key] ?? 0

            if (filter.key !== "all" && count === 0) return null

            const active = categoryFilter === filter.key

            return (

              <button

                key={filter.key}

                type="button"

                onClick={() => setCategoryFilter(filter.key)}

                style={{

                  border: active ? `1px solid ${filter.color}` : `1px solid ${BORDER}`,

                  borderRadius: 8,

                  background: active ? `${filter.color}18` : "#fff",

                  color: DARK,

                  padding: "4px 6px",

                  fontWeight: active ? 900 : 700,

                  cursor: "pointer",

                  textAlign: "left",

                  fontFamily: "inherit",

                  fontSize: 10,

                }}

              >

                {filter.emoji} {filter.label}{count > 0 ? ` (${count})` : ""}

              </button>

            )

          })}

          {directoryOnly ? (

            <span style={{ marginTop: 4, fontSize: 9, color: "#9CA3AF" }}>🔧 Сервіс · 🟣 Ви</span>

          ) : (

            <span style={{ marginTop: 4, fontSize: 9, color: "#9CA3AF" }}>🟢 Клієнт · 🟠 Партнер · 🔵 Куди</span>

          )}

        </div>

      ) : showBadges && !hideMapChrome && !compactMapTools ? (

        <MapLegend directoryOnly={directoryOnly} hasDestination={Boolean(destination)} hasPartner={Boolean(providerPosition)} overlayMode={overlayMode} />

      ) : null}

    </div>

  )

}



export default RouteMap

