import { useEffect, useMemo, useState } from "react"
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

import { acceptProviderOffer, cancelOrder as cancelOrderRequest, createAdminAccountSession, createAdminSession, createGuestCustomerSession, createOrder, createProviderAccountSession, createProviderSession, createTelegramCustomerSession, declineProviderOffer, getOrder, getOrders, getProviderOffers, getProviders, getTelegramSession, retryDispatch, reviewProviderVerification, submitCustomerVerification, submitProviderVerification, updateCustomerProfile, updateOrderStatus, updateProviderOrderStatus, updateProviderPresence, updateProviderProfile, type AuthSession, type CustomerProfile, type DispatchOffer, type OrderResponse, type ProviderAvailability, type VerificationStatus } from "./api/client"
import {
  calculateDistanceKm,
  calculatePrice,
  sanitizeLocation,
  validateCustomerOrderInput,
  type CustomerOrderInput,
  type ServiceKey,
} from "./lib/pomichDomain"
import { getTelegramContext } from "./telegram"

import type { LatLngTuple } from "leaflet"

type Role = "customer" | "provider" | "admin"
type Screen =
  | "home"
  | "location"
  | "destination"
  | "details"
  | "price"
  | "searching"
  | "assigned"
  | "tracking"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "error"
type OrderStatus = "draft" | "searching" | "assigned" | "en_route" | "arrived" | "in_progress" | "completed" | "cancelled"
type GeoState = "requesting" | "success" | "permission-denied" | "unavailable" | "telegram"

interface Point {
  lat: number
  lng: number
}

interface Provider {
  id: string
  name: string
  rating: number
  vehicle: string
  plate: string
  phone: string
  telegram: string
  etaMinutes: number
  earnings: number
}

interface PartnerRegistrationForm {
  name: string
  phone: string
  telegram: string
  vehicle: string
  plate: string
  specialties: ServiceKey[]
  serviceRadiusKm: number
  identityDocumentRef: string
  driverLicenseRef: string
  vehicleRegistrationRef: string
  serviceProofRef: string
  selfieRef: string
}

const BRAND = "#16A36A"
const DARK = "#111315"
const BG = "#F6F7F8"
const BORDER = "#E5E7EB"
const PICKUP: Point = { lat: 48.6208, lng: 22.2879 }
const DEFAULT_DESTINATION: Point = { lat: 48.6175, lng: 22.3056 }
const PROVIDER_START: Point = { lat: 48.632, lng: 22.271 }

const services = [
  { key: "tow", emoji: "🚛", label: "Евакуатор", tone: "#E8F8F1" },
  { key: "battery", emoji: "🔋", label: "Не заводиться", tone: "#EFF6FF" },
  { key: "wheel", emoji: "🛞", label: "Проблема з колесом", tone: "#FFF7ED" },
  { key: "fuel", emoji: "⛽", label: "Закінчилось пальне", tone: "#F5F3FF" },
  { key: "lockout", emoji: "🔑", label: "Не можу відкрити авто", tone: "#FCE7F3" },
  { key: "mechanic", emoji: "🔧", label: "Інша несправність", tone: "#ECFCCB" },
] as const

const providerCapabilityLabels: Record<ServiceKey, string> = {
  tow: "Евакуатор",
  battery: "Запуск акумулятора",
  wheel: "Колесо",
  fuel: "Привезти пальне",
  lockout: "Відкрити авто",
  mechanic: "Механік",
}

const vehicleOptions = [
  "Авто заводиться",
  "Авто не заводиться",
  "Після ДТП",
  "Заблоковані колеса",
  "Інше",
] as const

const provider: Provider = {
  id: "provider-oleksandr",
  name: "Олександр",
  rating: 4.9,
  vehicle: "Volkswagen Transporter",
  plate: "AO 1248 CH",
  phone: "+380671112233",
  telegram: "pomich_help_bot",
  etaMinutes: 12,
  earnings: 980,
}

const orderStatusLabels: Record<OrderStatus, string> = {
  draft: "Чернетка",
  searching: "Шукаємо виконавця",
  assigned: "Виконавця призначено",
  en_route: "Виконавець у дорозі",
  arrived: "Виконавець на місці",
  in_progress: "Допомога триває",
  completed: "Заявку завершено",
  cancelled: "Заявку скасовано",
}

function getServiceLabel(service?: string) {
  return services.find((item) => item.key === service)?.label ?? service ?? "Послуга"
}

function getProviderCapabilityLabel(service?: string) {
  return providerCapabilityLabels[service as ServiceKey] ?? getServiceLabel(service)
}

function toServiceKeys(value?: string[]): ServiceKey[] {
  return (value ?? []).filter((item): item is ServiceKey => services.some((service) => service.key === item))
}

function getActiveProviderId() {
  if (typeof window === "undefined") return provider.id
  return new URLSearchParams(window.location.search).get("providerId") || provider.id
}

function getStoredQueryToken(queryName: string, storageName: string) {
  if (typeof window === "undefined") return undefined
  const url = new URL(window.location.href)
  const queryToken = url.searchParams.get(queryName)
  const token = queryToken ?? window.sessionStorage.getItem(storageName)
  if (token) window.sessionStorage.setItem(storageName, token)
  if (queryToken) {
    url.searchParams.delete(queryName)
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }
  return token ?? undefined
}

const AUTH_SESSION_PREFIX = "pomich_auth_v1."

function isAuthSessionToken(token?: string) {
  return Boolean(token?.startsWith(AUTH_SESSION_PREFIX))
}

function authSessionStorageKey(role: "admin" | "provider" | "customer", subjectId: string) {
  return `pomichAuthSession:${role}:${subjectId}`
}

function readStoredAuthSession(storageKey: string, expectedRole: "admin" | "provider" | "customer", expectedSubjectId: string) {
  if (typeof window === "undefined") return undefined
  const rawValue = window.sessionStorage.getItem(storageKey)
  if (!rawValue) return undefined

  try {
    const session = JSON.parse(rawValue) as Partial<AuthSession>
    const expiresAt = Number(session.expiresAt ?? 0)
    if (session.role !== expectedRole || session.subjectId !== expectedSubjectId || !isAuthSessionToken(session.accessToken) || expiresAt <= Math.floor(Date.now() / 1000) + 30) {
      window.sessionStorage.removeItem(storageKey)
      return undefined
    }
    return session.accessToken
  } catch {
    if (isAuthSessionToken(rawValue)) return rawValue
    window.sessionStorage.removeItem(storageKey)
    return undefined
  }
}

function storeAuthSession(storageKey: string, session: AuthSession) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(storageKey, JSON.stringify(session))
}

function parseApiDateMs(value?: string) {
  if (!value) return Number.NaN
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  return new Date(hasTimezone ? value : `${value}Z`).getTime()
}

function getServiceEmoji(service?: string) {
  return services.find((item) => item.key === service)?.emoji ?? "🛠️"
}

function providerPoint(item: ProviderAvailability): Point | undefined {
  if (!item.location) return undefined
  return { lat: item.location.lat, lng: item.location.lng }
}

function isProviderAvailable(item: ProviderAvailability) {
  return (item.status === "online" || item.status === "busy") && isVerified(item.verificationStatus)
}

function distanceToProvider(pickup: Point, item: ProviderAvailability) {
  const point = providerPoint(item)
  return point ? calculateDistanceKm(pickup, point) : Number.POSITIVE_INFINITY
}

function nearbyProvidersFor(pickup: Point, providers: ProviderAvailability[]) {
  return providers
    .filter(isProviderAvailable)
    .slice()
    .sort((left, right) => distanceToProvider(pickup, left) - distanceToProvider(pickup, right))
}

function providerStatusLabel(status?: string) {
  if (status === "online") return "На лінії"
  if (status === "busy") return "У роботі"
  return "Поза лінією"
}

function verificationLabel(status?: VerificationStatus) {
  if (status === "verified") return "Перевірено POMICH"
  if (status === "pending") return "На перевірці"
  if (status === "rejected") return "Потрібне оновлення"
  return "Не перевірено"
}

function verificationTone(status?: VerificationStatus) {
  if (status === "verified") return { background: "#E8F8F1", color: BRAND, border: "#BFEAD8" }
  if (status === "pending") return { background: "#FFF7ED", color: "#B45309", border: "#FED7AA" }
  if (status === "rejected") return { background: "#FFF1F2", color: "#BE123C", border: "#FECDD3" }
  return { background: "#F3F4F6", color: "#6B7280", border: BORDER }
}

function isVerified(status?: VerificationStatus) {
  return !status || status === "verified"
}

function VerificationPill({ status }: { status?: VerificationStatus }) {
  const tone = verificationTone(status)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: tone.background, border: `1px solid ${tone.border}`, color: tone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: tone.color }} />
      {verificationLabel(status)}
    </span>
  )
}

const pickupIcon = L.divIcon({
  className: "pomich-pickup-marker",
  html: '<div style="width:24px;height:24px;border-radius:999px;background:#16A36A;border:3px solid white;box-shadow:0 8px 24px rgba(0,0,0,0.22)"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const destinationIcon = L.divIcon({
  className: "pomich-destination-marker",
  html: '<div style="width:24px;height:24px;border-radius:999px;background:#F59E0B;border:3px solid white;box-shadow:0 8px 24px rgba(0,0,0,0.22)"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const providerIcon = L.divIcon({
  className: "pomich-provider-marker",
  html: '<div style="width:28px;height:28px;border-radius:999px;background:#111315;border:3px solid white;box-shadow:0 8px 24px rgba(0,0,0,0.24);display:flex;align-items:center;justify-content:center;color:white;font-size:13px">🚛</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

function toTuple(point: Point): LatLngTuple {
  return [point.lat, point.lng]
}

function interpolate(from: Point, to: Point, progress: number): Point {
  const ratio = Math.max(0, Math.min(100, progress)) / 100
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mediaQuery = window.matchMedia(query)
    setMatches(mediaQuery.matches)
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches)
    mediaQuery.addEventListener("change", listener)
    return () => mediaQuery.removeEventListener("change", listener)
  }, [query])

  return matches
}

function ClickToPick({ onPick }: { onPick?: (point: Point) => void }) {
  useMapEvents({
    click(event) {
      onPick?.({ lat: event.latlng.lat, lng: event.latlng.lng })
    },
  })
  return null
}

function MapSizeController() {
  const map = useMap()

  useEffect(() => {
    const invalidate = () => map.invalidateSize(false)
    const timeoutId = window.setTimeout(invalidate, 0)
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(invalidate) : undefined
    observer?.observe(map.getContainer())

    return () => {
      window.clearTimeout(timeoutId)
      observer?.disconnect()
    }
  }, [map])

  return null
}

function RouteMap({
  pickup,
  destination,
  providers,
  providerPosition,
  subtitle,
  onPick,
  full = false,
  showBadges = true,
}: {
  pickup: Point
  destination?: Point
  providers?: ProviderAvailability[]
  providerPosition?: Point
  subtitle?: string
  onPick?: (point: Point) => void
  full?: boolean
  showBadges?: boolean
}) {
  const [mapMode, setMapMode] = useState<"online" | "offline">(() => (typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "online"))
  const route = destination ? [toTuple(pickup), toTuple(destination)] : undefined
  const center = providerPosition ? toTuple(providerPosition) : toTuple(pickup)
  const visibleProviders = providers?.filter(isProviderAvailable) ?? []

  return (
    <div style={{ height: full ? "100%" : 244, minHeight: full ? 0 : undefined, borderRadius: full ? 0 : 22, overflow: "hidden", border: full ? "none" : `1px solid ${BORDER}`, position: "relative", background: "#EAF4EE" }}>
      <MapContainer center={center} zoom={13} zoomControl={false} scrollWheelZoom={false} style={{ width: "100%", height: "100%" }}>
        <MapSizeController />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" eventHandlers={{ tileload: () => setMapMode("online"), tileerror: () => setMapMode("offline") }} />
        <ClickToPick onPick={onPick} />
        {route ? <Polyline positions={route} pathOptions={{ color: BRAND, weight: 5, opacity: 0.75 }} /> : null}
        <Marker position={toTuple(pickup)} icon={pickupIcon}>
          <Popup>Місце подачі</Popup>
        </Marker>
        {visibleProviders.map((item) => {
          const point = providerPoint(item)
          return point ? (
            <Marker key={item.id} position={toTuple(point)} icon={providerIcon}>
              <Popup>{item.name} · {providerStatusLabel(item.status)}</Popup>
            </Marker>
          ) : null
        })}
        {destination ? (
          <Marker position={toTuple(destination)} icon={destinationIcon}>
            <Popup>Пункт призначення</Popup>
          </Marker>
        ) : null}
        {providerPosition ? (
          <Marker position={toTuple(providerPosition)} icon={providerIcon}>
            <Popup>{provider.name} їде до вас</Popup>
          </Marker>
        ) : null}
      </MapContainer>
      {showBadges && subtitle ? (
        <div style={{ position: "absolute", zIndex: 1100, left: 12, bottom: 12, background: "rgba(255,255,255,0.94)", borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 800, color: DARK }}>
          {subtitle}
        </div>
      ) : null}
      {showBadges ? (
        <div style={{ position: "absolute", zIndex: 1100, right: 12, top: 12, background: mapMode === "online" ? "rgba(232,248,241,0.96)" : "rgba(255,247,237,0.96)", color: mapMode === "online" ? BRAND : "#B45309", borderRadius: 999, padding: "7px 10px", fontSize: 11, fontWeight: 900, boxShadow: "0 4px 14px rgba(0,0,0,0.08)" }}>
          {mapMode === "online" ? "Карта онлайн" : "Кеш карти"}
        </div>
      ) : null}
    </div>
  )
}

function PrimaryButton({ label, onClick, loading = false, disabled = false }: { label: string; onClick?: () => void; loading?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{ width: "100%", minHeight: 48, padding: "14px 16px", borderRadius: 14, background: disabled || loading ? "#CBD5E1" : BRAND, color: "#fff", border: "none", fontSize: 15, fontWeight: 800, cursor: disabled || loading ? "not-allowed" : "pointer", fontFamily: "inherit" }}
    >
      {loading ? "Створюємо заявку…" : label}
    </button>
  )
}

function SecondaryButton({ label, onClick, danger = false, disabled = false }: { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: "100%", minHeight: 46, padding: "12px 14px", borderRadius: 14, background: disabled ? "#F3F4F6" : danger ? "#FFF1F2" : "#F3F4F6", color: disabled ? "#9CA3AF" : danger ? "#BE123C" : "#374151", border: `1px solid ${danger ? "#FECDD3" : BORDER}`, fontSize: 14, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}
    >
      {label}
    </button>
  )
}

function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "7px 10px", background: status === "cancelled" ? "#FFF1F2" : "#E8F8F1", color: status === "cancelled" ? "#BE123C" : BRAND, fontSize: 12, fontWeight: 900 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "currentColor" }} />
      {orderStatusLabels[status]}
    </div>
  )
}

function Timeline({ status }: { status: OrderStatus }) {
  const steps: Array<{ status: OrderStatus; label: string }> = [
    { status: "searching", label: "Пошук" },
    { status: "assigned", label: "Назначено" },
    { status: "en_route", label: "У дорозі" },
    { status: "arrived", label: "На місці" },
    { status: "in_progress", label: "Робота" },
    { status: "completed", label: "Готово" },
  ]
  const currentIndex = status === "cancelled" ? -1 : Math.max(0, steps.findIndex((step) => step.status === status))

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 6 }}>
      {steps.map((step, index) => {
        const active = index <= currentIndex
        return (
          <div key={step.status} style={{ minWidth: 0 }}>
            <div style={{ height: 5, borderRadius: 999, background: active ? BRAND : BORDER }} />
            <div style={{ marginTop: 5, fontSize: 10, color: active ? DARK : "#9CA3AF", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{step.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function ProviderCard({ orderId, eta, assignedProvider }: { orderId?: string; eta?: number; assignedProvider?: OrderResponse["assignedProvider"] | ProviderAvailability }) {
  const cardProvider = assignedProvider ?? provider
  const phone = cardProvider.phone ?? provider.phone
  const telegram = cardProvider.telegram ?? provider.telegram
  const rating = cardProvider.rating ?? provider.rating
  const distanceKm = "distanceKm" in cardProvider && typeof cardProvider.distanceKm === "number" ? cardProvider.distanceKm : undefined
  const verificationStatus = "verificationStatus" in cardProvider ? cardProvider.verificationStatus : "verified"
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, boxShadow: "0 8px 22px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: "#E8F8F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🚛</div>
          <div>
            <div style={{ fontWeight: 900, color: DARK }}>{cardProvider.name ?? provider.name}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{cardProvider.vehicle ?? provider.vehicle} · {cardProvider.plate ?? provider.plate}</div>
            <div style={{ marginTop: 6 }}><VerificationPill status={verificationStatus} /></div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontWeight: 900, color: BRAND }}>★ {rating}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
        <a href={`tel:${phone}`} style={{ textDecoration: "none" }}><SecondaryButton label="📞 Подзвонити" /></a>
        <a href={`https://t.me/${telegram}${orderId ? `?start=order_${orderId}` : ""}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><SecondaryButton label="💬 Чат" /></a>
      </div>
      {eta ? <div style={{ marginTop: 10, color: "#6B7280", fontSize: 13, fontWeight: 700 }}>Прибуття приблизно за {eta} хв</div> : null}
      {distanceKm ? <div style={{ marginTop: 6, color: "#6B7280", fontSize: 13, fontWeight: 700 }}>{distanceKm.toFixed(1)} км від вас</div> : null}
    </div>
  )
}

function AppShell({ children, compact, role, onRoleChange }: { children: React.ReactNode; compact: boolean; role: Role | null; onRoleChange: (role: Role | null) => void }) {
  if (compact) {
    return (
      <div style={{ width: "100vw", maxWidth: "100vw", minHeight: "100vh", height: "100dvh", overflowX: "hidden", background: BG, color: DARK, display: "flex", flexDirection: "column" }}>
        {role ? (
          <div style={{ height: 46, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: "#fff", borderBottom: `1px solid ${BORDER}` }}>
            <a href="/" style={{ textDecoration: "none", color: BRAND, fontWeight: 950 }}>← Лендинг</a>
            <div style={{ fontWeight: 950, color: DARK }}>{role === "customer" ? "Клієнт" : role === "provider" ? "Партнер" : "Адмін"}</div>
          </div>
        ) : null}
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, width: "100%", overflowX: "hidden" }}>{children}</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", height: "100vh", background: BG, color: DARK, display: "flex", flexDirection: "column" }}>
      {role ? (
        <div style={{ height: 62, background: "#fff", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
          <div style={{ width: "100%", maxWidth: 1280, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <a href="/" style={{ textDecoration: "none", fontSize: 20, fontWeight: 950, color: DARK }}>POMICH</a>
            <div style={{ display: "flex", gap: 8, alignItems: "center", overflowX: "auto" }}>
              {[
                { key: "customer", label: "Клієнт" },
                { key: "provider", label: "Партнер" },
              ].map((item) => (
                <button key={item.key} onClick={() => onRoleChange(item.key as Role)} style={{ flex: "0 0 auto", border: role === item.key ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: role === item.key ? "#E8F8F1" : "#fff", color: role === item.key ? BRAND : DARK, borderRadius: 999, padding: "8px 12px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>
                  {item.label}
                </button>
              ))}
              <a href="/" style={{ flex: "0 0 auto", border: `1px solid ${BORDER}`, background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 12px", fontWeight: 900, textDecoration: "none" }}>
                Лендинг
              </a>
            </div>
          </div>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  )
}

function ScreenLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: "100%", minHeight: "100%", display: "flex", flexDirection: "column", overflowX: "hidden", background: BG }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", overflowX: "hidden" }}>{children}</div>
      {footer ? <div style={{ padding: 16, background: "#fff", borderTop: `1px solid ${BORDER}` }}>{footer}</div> : null}
    </div>
  )
}

function Header({ title, subtitle, onBack, status }: { title: string; subtitle?: string; onBack?: () => void; status?: OrderStatus }) {
  return (
    <div style={{ padding: "16px 16px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {onBack ? <button aria-label="Назад" onClick={onBack} style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", padding: 0 }}>←</button> : null}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 18, color: DARK }}>{title}</div>
            {subtitle ? <div style={{ marginTop: 3, color: "#6B7280", fontSize: 12, fontWeight: 700 }}>{subtitle}</div> : null}
          </div>
        </div>
        {status ? <StatusPill status={status} /> : null}
      </div>
    </div>
  )
}

function RideScreen({
  pickup,
  destination,
  providers,
  providerPosition,
  mapSubtitle,
  children,
}: {
  pickup: Point
  destination?: Point
  providers?: ProviderAvailability[]
  providerPosition?: Point
  mapSubtitle?: string
  children: React.ReactNode
}) {
  const compact = useMediaQuery("(max-width: 760px)")

  return (
    <div style={{ height: "100%", minHeight: "100%", position: "relative", overflow: "hidden", background: "#DDE7E2" }}>
      <RouteMap pickup={pickup} destination={destination} providers={providers} providerPosition={providerPosition} subtitle={mapSubtitle} full />
      <div style={{ position: "absolute", zIndex: 1200, top: compact ? 12 : 20, left: compact ? 12 : 24, right: compact ? 12 : 24, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, pointerEvents: "none" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.96)", border: `1px solid ${BORDER}`, borderRadius: 999, padding: "9px 13px", boxShadow: "0 10px 30px rgba(17,19,21,0.12)", color: DARK, fontWeight: 950 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: BRAND }} />
          POMICH
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.96)", border: `1px solid ${BORDER}`, borderRadius: 999, padding: "9px 12px", boxShadow: "0 10px 30px rgba(17,19,21,0.12)", color: "#374151", fontSize: 12, fontWeight: 900 }}>
          Допомога поруч
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          zIndex: 1300,
          left: compact ? 0 : 24,
          right: compact ? 0 : "auto",
          bottom: compact ? 0 : 24,
          top: compact ? "auto" : 84,
          width: compact ? "100%" : 392,
          maxHeight: compact ? "70%" : "calc(100% - 108px)",
          overflow: "auto",
          background: "#fff",
          border: compact ? "none" : `1px solid ${BORDER}`,
          borderRadius: compact ? "24px 24px 0 0" : 24,
          boxShadow: "0 20px 70px rgba(17,19,21,0.22)",
          padding: compact ? "10px 16px 16px" : 18,
        }}
      >
        {compact ? <div style={{ width: 46, height: 4, borderRadius: 999, background: "#D1D5DB", margin: "0 auto 14px" }} /> : null}
        {children}
      </div>
    </div>
  )
}

function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{ fontSize: 24, lineHeight: 1.08, fontWeight: 950, color: DARK }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 7, color: "#6B7280", fontSize: 14, lineHeight: 1.35, fontWeight: 750 }}>{subtitle}</div> : null}
    </div>
  )
}

function LocationRow({ icon, title, subtitle, active = false }: { icon: string; title: string; subtitle: string; active?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: 11, alignItems: "center", padding: "11px 0" }}>
      <div style={{ width: 36, height: 36, borderRadius: 12, background: active ? "#E8F8F1" : "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: DARK, fontWeight: 900, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ color: "#6B7280", fontWeight: 700, fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</div>
      </div>
    </div>
  )
}

function SheetDivider() {
  return <div style={{ height: 1, background: BORDER, margin: "4px 0" }} />
}

function AvailabilityPanel({ pickup, providers, loading }: { pickup: Point; providers: ProviderAvailability[]; loading: boolean }) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const nearest = nearby[0]

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 950, color: DARK }}>{loading ? "Перевіряємо партнерів" : nearby.length > 0 ? `${nearby.length} на лінії поруч` : "Партнерів поруч не видно"}</div>
          <div style={{ color: "#6B7280", fontWeight: 700, fontSize: 12, marginTop: 4 }}>{nearest ? `Найближчий: ${nearest.name} · ~${nearest.etaMinutes ?? Math.ceil(distanceToProvider(pickup, nearest) * 4)} хв` : "Можна створити заявку, диспетчер підключить найближчого вручну."}</div>
        </div>
        <div style={{ borderRadius: 999, padding: "7px 10px", background: nearby.length > 0 ? "#E8F8F1" : "#FFF7ED", color: nearby.length > 0 ? BRAND : "#B45309", fontSize: 12, fontWeight: 950 }}>
          {nearby.length > 0 ? "Live" : "Очікування"}
        </div>
      </div>
      {nearby.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {nearby.slice(0, 2).map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: BG, borderRadius: 14, padding: "10px 12px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: DARK, fontWeight: 900, fontSize: 13 }}>{item.name} · {item.vehicle ?? "Автодопомога"}</div>
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 700, marginTop: 2 }}>{providerStatusLabel(item.status)} · {distanceToProvider(pickup, item).toFixed(1)} км</div>
                <div style={{ color: "#6B7280", fontSize: 11, fontWeight: 800, marginTop: 3 }}>{toServiceKeys(item.specialties).map(getProviderCapabilityLabel).join(" · ") || "Послуги уточнюються"}</div>
                <div style={{ marginTop: 7 }}><VerificationPill status={item.verificationStatus} /></div>
              </div>
              <div style={{ color: BRAND, fontWeight: 950, whiteSpace: "nowrap" }}>~{item.etaMinutes ?? Math.ceil(distanceToProvider(pickup, item) * 4)} хв</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CustomerTrustPanel({
  profile,
  saving,
  error,
  onVerify,
}: {
  profile: CustomerProfile
  saving: boolean
  error?: string
  onVerify: () => void
}) {
  const completeness = profile.profileCompleteness ?? 50
  const initials = (profile.name || "POMICH").trim().slice(0, 1).toUpperCase()
  const badges = profile.trustedBadges?.length ? profile.trustedBadges : ["Телефон", "Профіль"]

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12, minWidth: 0 }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, fontSize: 20, flex: "0 0 auto" }}>{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: DARK, fontWeight: 950, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{profile.name || "Клієнт POMICH"}</div>
            <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>{profile.city || "Київ"} · ★ {profile.rating ?? 5} · {profile.ordersCompleted ?? 0} заявок</div>
            <div style={{ marginTop: 7 }}><VerificationPill status={profile.verificationStatus} /></div>
          </div>
        </div>
        <div style={{ color: BRAND, fontWeight: 950, fontSize: 13, whiteSpace: "nowrap" }}>{completeness}%</div>
      </div>
      <div style={{ height: 7, borderRadius: 999, background: "#EEF2F7", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(12, Math.min(100, completeness))}%`, height: "100%", borderRadius: 999, background: BRAND }} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {badges.slice(0, 3).map((badge) => (
          <span key={badge} style={{ borderRadius: 999, padding: "6px 9px", background: "#F3F4F6", color: "#374151", fontSize: 11, fontWeight: 900 }}>{badge}</span>
        ))}
      </div>
      <button onClick={onVerify} disabled={saving} style={{ minHeight: 42, borderRadius: 14, border: `1px solid ${BORDER}`, background: saving ? "#E5E7EB" : "#F9FAFB", color: DARK, fontFamily: "inherit", fontWeight: 950, cursor: saving ? "not-allowed" : "pointer" }}>
        {saving ? "Надсилаємо…" : profile.verificationStatus === "pending" ? "Оновити перевірку" : "Підтвердити профіль"}
      </button>
      {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 850 }}>{error}</div> : null}
    </div>
  )
}

function HomeStep({
  pickup,
  locationLabel,
  providers,
  providersLoading,
  customerProfile,
  customerVerificationSaving,
  customerVerificationError,
  onVerifyCustomer,
  onSelect,
}: {
  pickup: Point
  locationLabel: string
  providers: ProviderAvailability[]
  providersLoading: boolean
  customerProfile: CustomerProfile
  customerVerificationSaving: boolean
  customerVerificationError?: string
  onVerifyCustomer: () => void
  onSelect: (service: ServiceKey) => void
}) {
  const nearby = nearbyProvidersFor(pickup, providers)
  return (
    <RideScreen pickup={pickup} providers={providers} mapSubtitle={locationLabel}>
      <SheetHeading title="Потрібна допомога на дорозі?" subtitle="Оберіть проблему, а POMICH знайде найближчого перевіреного партнера." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="●" title="Поточне місце" subtitle={locationLabel} active />
        <SheetDivider />
        <LocationRow icon="🏁" title="Куди везти або де ремонтувати" subtitle="Уточнимо після вибору послуги" />
      </div>

      <div style={{ marginTop: 14 }}>
        <CustomerTrustPanel profile={customerProfile} saving={customerVerificationSaving} error={customerVerificationError} onVerify={onVerifyCustomer} />
      </div>

      <div style={{ marginTop: 14 }}>
        <AvailabilityPanel pickup={pickup} providers={providers} loading={providersLoading} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 18, marginBottom: 10 }}>
        <div style={{ fontWeight: 950, fontSize: 18, color: DARK }}>Що сталося?</div>
        <div style={{ borderRadius: 999, padding: "7px 10px", background: nearby.length > 0 ? "#E8F8F1" : "#FFF7ED", color: nearby.length > 0 ? BRAND : "#B45309", fontSize: 12, fontWeight: 950 }}>
          {nearby.length > 0 ? "~12 хв" : "диспетчер"}
        </div>
      </div>

      <div style={{ display: "grid", gap: 9 }}>
        {services.map((service) => (
          <button key={service.key} onClick={() => onSelect(service.key as ServiceKey)} style={{ minHeight: 64, display: "grid", gridTemplateColumns: "44px 1fr auto", alignItems: "center", gap: 12, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "11px 12px", background: "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 22px rgba(17,19,21,0.04)" }}>
            <span style={{ width: 44, height: 44, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", background: service.tone, fontSize: 21 }}>{service.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 950, color: DARK }}>{service.label}</span>
              <span style={{ display: "block", marginTop: 3, fontSize: 12, fontWeight: 750, color: "#6B7280" }}>{nearby.length > 0 ? "Найближчий партнер поруч" : "Підключимо диспетчера"}</span>
            </span>
            <span style={{ color: BRAND, fontWeight: 950, fontSize: 13 }}>›</span>
          </button>
        ))}
      </div>
    </RideScreen>
  )
}

function LocationStep({ pickup, geoMessage, onPick, onBack, onNext }: { pickup: Point; geoMessage: string; onPick: (point: Point) => void; onBack: () => void; onNext: () => void }) {
  return (
    <RideScreen pickup={pickup} mapSubtitle="Точка подачі">
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Ваше місцезнаходження" subtitle="Натисніть на карту, якщо точка неточна. Партнер побачить лише приблизну адресу." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="📍" title="Точка подачі" subtitle={`${pickup.lat.toFixed(5)}, ${pickup.lng.toFixed(5)}`} active />
        <SheetDivider />
        <LocationRow icon="🛰️" title="Статус геолокації" subtitle={geoMessage} />
      </div>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton label="Підтвердити місце" onClick={onNext} />
      </div>
    </RideScreen>
  )
}

function DestinationStep({ pickup, destination, value, onPick, onChange, onNext, onBack }: { pickup: Point; destination: Point; value: string; onPick: (point: Point) => void; onChange: (value: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Маршрут до призначення">
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Куди доставити авто?" subtitle="Введіть СТО, адресу або точку, куди має їхати виконавець." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="●" title="Звідки" subtitle="Поточне місце клієнта" active />
        <SheetDivider />
        <LocationRow icon="🏁" title="Куди" subtitle={value || "Оберіть призначення"} />
      </div>

      <label style={{ display: "grid", gap: 8, marginTop: 16 }}>
        <span style={{ fontWeight: 900, color: DARK }}>Адреса доставки</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Наприклад: СТО «Авторемонт»" style={{ width: "100%", minHeight: 50, padding: "0 14px", borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 750, fontFamily: "inherit" }} />
      </label>
      <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 750, marginTop: 8 }}>Точка: {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</div>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton label="Далі" onClick={onNext} disabled={!value.trim()} />
      </div>
    </RideScreen>
  )
}

function DetailsStep({ pickup, destination, value, onChange, onNext, onBack }: { pickup: Point; destination: Point; value: string; onChange: (value: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Підбір виконавця">
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Що з автомобілем?" subtitle="Це допоможе підібрати правильний транспорт, інструменти та ETA." />

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {vehicleOptions.map((option) => (
          <button key={option} onClick={() => onChange(option)} style={{ minHeight: 54, padding: "12px 14px", borderRadius: 16, border: value === option ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: value === option ? "#E8F8F1" : "#fff", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, color: DARK }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span>{option}</span>
              <span style={{ color: value === option ? BRAND : "#9CA3AF" }}>{value === option ? "✓" : "○"}</span>
            </span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <PrimaryButton label="Далі" onClick={onNext} disabled={!value} />
      </div>
    </RideScreen>
  )
}

function PriceStep({ serviceLabel, breakdown, pickup, destination, loading, onConfirm, onBack }: { serviceLabel: string; breakdown: ReturnType<typeof calculatePrice>; pickup: Point; destination: Point; loading: boolean; onConfirm: () => void; onBack: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle={`${breakdown.distanceKm.toFixed(1)} км · ~${breakdown.etaMinutes} хв`}>
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Підтвердження" subtitle="Фіксуємо орієнтовну ціну та показуємо заявку партнерам поруч." />

      <div style={{ marginTop: 16, background: "#111315", color: "#fff", borderRadius: 22, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#A7F3D0", fontWeight: 900, fontSize: 13 }}>{serviceLabel}</div>
            <div style={{ fontSize: 34, fontWeight: 950, marginTop: 6 }}>{breakdown.price.toLocaleString("uk-UA")} ₴</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: 999, padding: "8px 11px", fontSize: 13, fontWeight: 900 }}>~{breakdown.etaMinutes} хв</div>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 18, padding: 16, marginTop: 12, border: `1px solid ${BORDER}` }}>
          {[
            ["Подача", `${breakdown.serviceFee} ₴`],
            ["Маршрут", `${breakdown.distanceKm.toFixed(1)} км`],
            ["Перевезення", `${breakdown.routeFee} ₴`],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 16 }}>
              <span style={{ color: "#6B7280" }}>{label}</span>
              <span style={{ fontWeight: 900, color: DARK }}>{value}</span>
            </div>
          ))}
          <div style={{ height: 1, background: BORDER, margin: "10px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 900, color: DARK }}>Разом</span>
            <span style={{ fontSize: 24, fontWeight: 950, color: BRAND }}>{breakdown.price.toLocaleString("uk-UA")} ₴</span>
          </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton label={`Викликати за ${breakdown.price.toLocaleString("uk-UA")} ₴`} onClick={onConfirm} loading={loading} disabled={loading} />
      </div>
    </RideScreen>
  )
}

function SearchingStep({ orderId, status, order, onCancel, onRetryDispatch }: { orderId?: string; status: OrderStatus; order?: OrderResponse; onCancel: () => void; onRetryDispatch: () => void }) {
  const noProviders = order?.dispatchState === "NO_PROVIDERS_AVAILABLE"
  const offersSent = order?.dispatchInfo?.offersSent ?? order?.offers?.length ?? 0
  return (
    <RideScreen pickup={PICKUP} destination={DEFAULT_DESTINATION} providers={order?.assignedProvider ? [order.assignedProvider] : undefined} mapSubtitle={orderId ? `#${orderId}` : "Пошук поруч"}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Заявку створено" subtitle={noProviders ? "Немає вільних партнерів поруч" : orderId ? `Замовлення #${orderId}` : "Шукаємо допомогу поруч…"} />
        <StatusPill status={status} />
      </div>

      <div style={{ position: "relative", height: 142, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 8 }}>
        {[0, 1, 2].map((item) => (
          <div key={item} className="pulse-ring" style={{ position: "absolute", width: 70 + item * 42, height: 70 + item * 42, borderRadius: 999, background: BRAND, opacity: 0.12 }} />
        ))}
        <div style={{ width: 72, height: 72, borderRadius: 24, background: "#111315", boxShadow: "0 16px 36px rgba(17,19,21,0.24)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🚛</div>
      </div>

      <div style={{ color: "#6B7280", fontWeight: 750, lineHeight: 1.4 }}>{noProviders ? "Можна повторити пошук без створення нової заявки." : offersSent > 0 ? `Звернулися до ${offersSent} виконавців. Перший, хто підтвердить, отримає заявку.` : "Показуємо заявку найближчим перевіреним партнерам."}</div>
      <div style={{ marginTop: 16 }}><Timeline status={status} /></div>
      <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
        {["Перевіряємо доступність", "Порівнюємо ETA та рейтинг", "Фіксуємо деталі заявки"].map((item) => (
          <div key={item} style={{ background: "#F9FAFB", borderRadius: 15, border: `1px solid ${BORDER}`, padding: "12px 14px", fontWeight: 850, color: DARK }}>✓ {item}</div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {noProviders ? <PrimaryButton label="Спробувати ще раз" onClick={onRetryDispatch} /> : null}
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function AssignedStep({ orderId, status, order, onTrack, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; onTrack: () => void; onCancel: () => void }) {
  const assignedProvider = order?.assignedProvider
  return (
    <RideScreen pickup={PICKUP} destination={DEFAULT_DESTINATION} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Виконавець призначений">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Виконавця призначено" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={assignedProvider?.etaMinutes ?? provider.etaMinutes} assignedProvider={assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
        </div>
        <div style={{ background: "#E8F8F1", borderRadius: 18, padding: 14, color: DARK, fontWeight: 800 }}>{assignedProvider?.name ?? "Виконавець"} підтвердив заявку. Допомога вже їде.</div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Дивитися маршрут" onClick={onTrack} />
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function TrackingStep({ orderId, status, order, pickup, destination, progress, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; progress: number; onCancel: () => void }) {
  const start = order?.assignedProvider?.location ?? PROVIDER_START
  const providerPosition = interpolate(start, pickup, Math.min(progress, 92))
  const eta = Math.max(1, Math.ceil((100 - progress) / 12))

  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={providerPosition} mapSubtitle={`ETA ${eta} хв · ${Math.round(progress)}% маршруту`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Виконавець у дорозі" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <div style={{ background: "#111315", color: "#fff", borderRadius: 999, padding: "9px 12px", fontWeight: 950 }}>{eta} хв</div>
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={order?.assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ height: 9, background: "#EDF2F7", borderRadius: 999, marginTop: 14 }}>
            <div style={{ width: `${Math.max(8, progress)}%`, height: "100%", borderRadius: 999, background: BRAND }} />
          </div>
          <div style={{ color: "#6B7280", fontSize: 13, fontWeight: 700, marginTop: 8 }}>{progress > 82 ? "Виконавець поруч із вами." : "Виконавець рухається до точки подачі."}</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label={`Очікувати · ${eta} хв`} disabled />
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function ArrivedStep({ orderId, status, order, onComplete, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; onComplete: () => void; onCancel: () => void }) {
  return (
    <RideScreen pickup={PICKUP} destination={DEFAULT_DESTINATION} providerPosition={PICKUP} mapSubtitle="Виконавець на місці">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Виконавець на місці" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} assignedProvider={order?.assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Допомога надається</div>
          <div style={{ marginTop: 6, color: "#6B7280", fontWeight: 700 }}>Після завершення підтвердьте заявку, щоб оновити статус у POMICH.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Очікуємо початок робіт" onClick={onComplete} disabled />
        <SecondaryButton label="Скасувати" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function InProgressStep({ orderId, status, order, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; onCancel: () => void }) {
  return (
    <RideScreen pickup={PICKUP} destination={DEFAULT_DESTINATION} providerPosition={PICKUP} mapSubtitle="Допомога триває">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Допомога триває" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} assignedProvider={order?.assignedProvider} />
        <div style={{ background: "#fff", borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Виконавець працює із заявкою</div>
          <div style={{ marginTop: 6, color: "#6B7280", fontWeight: 700 }}>Статус оновиться автоматично після завершення робіт у системі.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Очікуємо завершення робіт" disabled />
        <SecondaryButton label="Скасувати" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function FinalStep({ orderId, status, onRestart }: { orderId?: string; status: "completed" | "cancelled"; onRestart: () => void }) {
  const cancelled = status === "cancelled"
  return (
    <ScreenLayout footer={<PrimaryButton label="Нова заявка" onClick={onRestart} />}>
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 24, textAlign: "center", background: cancelled ? "#FFF7F7" : "linear-gradient(135deg, #E8F8F1 0%, #F6F7F8 100%)" }}>
        <div style={{ fontSize: 54, marginBottom: 12 }}>{cancelled ? "✕" : "✅"}</div>
        <div style={{ fontSize: 24, fontWeight: 950, color: DARK }}>{cancelled ? "Заявку скасовано" : "Заявку завершено"}</div>
        <div style={{ marginTop: 8, fontSize: 15, color: "#4B5563" }}>{orderId ? `Замовлення #${orderId}` : "POMICH"}</div>
      </div>
    </ScreenLayout>
  )
}

function ErrorStep({ onRetry }: { onRetry: () => void }) {
  return (
    <ScreenLayout footer={<PrimaryButton label="Повторити" onClick={onRetry} />}>
      <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 24, textAlign: "center", background: "#FFF7F7" }}>
        <div style={{ fontSize: 54, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 24, fontWeight: 950, color: DARK }}>Не вдалося створити заявку.</div>
        <div style={{ marginTop: 10, color: "#6B7280", fontSize: 14, fontWeight: 700 }}>Перевірте підключення та спробуйте ще раз.</div>
      </div>
    </ScreenLayout>
  )
}

function AccountLoginStep({
  title,
  subtitle,
  login,
  password,
  saving,
  error,
  onLoginChange,
  onPasswordChange,
  onSubmit,
}: {
  title: string
  subtitle: string
  login: string
  password: string
  saving: boolean
  error?: string
  onLoginChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <ScreenLayout footer={<PrimaryButton label={saving ? "Входимо…" : "Увійти"} onClick={onSubmit} disabled={!login.trim() || !password.trim() || saving} />}>
      <Header title={title} subtitle={subtitle} />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Логін</span>
            <input value={login} onChange={(event) => onLoginChange(event.target.value)} autoComplete="username" style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Пароль</span>
            <input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete="current-password" style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
          </label>
        </div>
        {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{error}</div> : null}
      </div>
    </ScreenLayout>
  )
}

function ProviderRegistrationStep({
  form,
  saving,
  error,
  onChange,
  onToggleSpecialty,
  onSubmit,
}: {
  form: PartnerRegistrationForm
  saving: boolean
  error?: string
  onChange: (patch: Partial<PartnerRegistrationForm>) => void
  onToggleSpecialty: (specialty: ServiceKey) => void
  onSubmit: () => void
}) {
  const canSubmit = Boolean(form.name.trim() && form.phone.trim() && form.vehicle.trim() && form.specialties.length > 0)
  const documentsReady = Boolean(form.identityDocumentRef.trim() && form.driverLicenseRef.trim() && form.vehicleRegistrationRef.trim() && form.serviceProofRef.trim() && form.selfieRef.trim())

  return (
    <ScreenLayout footer={<PrimaryButton label={saving ? "Зберігаємо профіль…" : documentsReady ? "Зберегти і подати на перевірку" : "Зберегти профіль"} onClick={onSubmit} disabled={!canSubmit || saving} />}>
      <Header title="Реєстрація партнера" subtitle="Вкажіть, яку допомогу ви реально можете виконувати" />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Ім'я партнера</span>
            <input value={form.name} onChange={(event) => onChange({ name: event.target.value })} style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Телефон</span>
            <input value={form.phone} onChange={(event) => onChange({ phone: event.target.value })} inputMode="tel" style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Telegram</span>
            <input value={form.telegram} onChange={(event) => onChange({ telegram: event.target.value })} style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
          </label>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Авто / техніка</span>
            <input value={form.vehicle} onChange={(event) => onChange({ vehicle: event.target.value })} style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Номер</span>
              <input value={form.plate} onChange={(event) => onChange({ plate: event.target.value })} style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Радіус, км</span>
              <input value={form.serviceRadiusKm} onChange={(event) => onChange({ serviceRadiusKm: Number(event.target.value) || 1 })} min={1} max={50} type="number" inputMode="numeric" style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
            </label>
          </div>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 950, color: DARK }}>Ваші послуги</div>
              <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>{form.specialties.length} обрано</div>
            </div>
            <div style={{ background: form.specialties.length > 0 ? "#E8F8F1" : "#FFF7ED", color: form.specialties.length > 0 ? BRAND : "#B45309", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 950 }}>
              {form.specialties.length > 0 ? "Готово" : "Оберіть"}
            </div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {services.map((service) => {
              const selected = form.specialties.includes(service.key)
              return (
                <button key={service.key} onClick={() => onToggleSpecialty(service.key)} style={{ minHeight: 62, border: selected ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: selected ? "#E8F8F1" : service.tone, borderRadius: 14, padding: 10, textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: DARK }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 20 }}>{service.emoji}</span>
                    <span style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.2 }}>{getProviderCapabilityLabel(service.key)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 950, color: DARK }}>Перевірка партнера</div>
              <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>Допуск до заявок після review диспетчера</div>
            </div>
            <div style={{ borderRadius: 999, padding: "7px 10px", background: documentsReady ? "#E8F8F1" : "#FFF7ED", color: documentsReady ? BRAND : "#B45309", fontSize: 12, fontWeight: 950 }}>
              {documentsReady ? "Готово" : "Документи"}
            </div>
          </div>
          {[
            ["identityDocumentRef", "ID / паспорт", "doc://passport-front"],
            ["driverLicenseRef", "Водійське посвідчення", "doc://driver-license"],
            ["vehicleRegistrationRef", "Реєстрація авто", "doc://vehicle-registration"],
            ["serviceProofRef", "Підтвердження сервісу", "doc://tools-or-company"],
            ["selfieRef", "Selfie-check", "doc://selfie"],
          ].map(([key, label, placeholder]) => (
            <label key={key} style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>{label}</span>
              <input value={String(form[key as keyof PartnerRegistrationForm] ?? "")} onChange={(event) => onChange({ [key]: event.target.value } as Partial<PartnerRegistrationForm>)} placeholder={placeholder} style={{ height: 42, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
            </label>
          ))}
        </div>

        {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{error}</div> : null}
      </div>
    </ScreenLayout>
  )
}

function IncomingOfferStep({
  offer,
  secondsLeft,
  saving,
  error,
  onAccept,
  onDecline,
}: {
  offer: DispatchOffer
  secondsLeft: number
  saving: boolean
  error?: string
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <ScreenLayout footer={<div style={{ display: "grid", gap: 10 }}><PrimaryButton label={saving ? "Приймаємо…" : "ПРИЙНЯТИ"} onClick={onAccept} disabled={saving || secondsLeft <= 0} /><SecondaryButton label="ПРОПУСТИТИ" onClick={onDecline} /></div>}>
      <Header title="Нове замовлення" subtitle={secondsLeft > 0 ? `${secondsLeft} сек` : "Час вийшов"} status="searching" />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 950, fontSize: 20, color: DARK }}>{getServiceEmoji(offer.service)} {getProviderCapabilityLabel(offer.service)}</div>
              <div style={{ color: "#6B7280", fontWeight: 750, marginTop: 5 }}>До клієнта: {offer.distanceKm?.toFixed(1) ?? "?"} км</div>
            </div>
            <div style={{ background: "#E8F8F1", color: BRAND, borderRadius: 999, padding: "8px 10px", fontWeight: 950 }}>~{offer.etaMinutes ?? Math.ceil((offer.distanceKm ?? 1) * 4)} хв</div>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 8, color: DARK, fontSize: 13 }}>
            <div><strong>Авто:</strong> {offer.vehicleState ?? "Не вказано"}</div>
            <div><strong>Район:</strong> {offer.approximateLocation ?? "Поруч із вами"}</div>
          </div>
          <div style={{ marginTop: 14 }}>
            <Timeline status="searching" />
          </div>
        </div>
        {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{error}</div> : null}
      </div>
    </ScreenLayout>
  )
}

const LANDING_PICKUP: Point = { lat: 50.4501, lng: 30.5234 }
const LANDING_DESTINATION: Point = { lat: 50.4547, lng: 30.5038 }

const landingProviders: ProviderAvailability[] = [
  {
    id: "landing-oleksandr",
    name: "Олександр",
    status: "online",
    vehicle: "Volkswagen Transporter",
    rating: 4.9,
    etaMinutes: 12,
    location: { lat: 50.4448, lng: 30.5166 },
    specialties: ["tow", "fuel"],
  },
  {
    id: "landing-mykhailo",
    name: "Михайло",
    status: "busy",
    vehicle: "Renault Master",
    rating: 4.8,
    etaMinutes: 18,
    location: { lat: 50.4635, lng: 30.5179 },
    specialties: ["battery", "wheel"],
  },
]

const landingStats = [
  ["24/7", "Заявка з дороги"],
  ["12 хв", "Орієнтовний ETA"],
  ["2 ролі", "Клієнт і партнер"],
] as const

const landingFeatures = [
  ["🗺️", "Live-карта партнерів", "Клієнт одразу бачить доступність поруч, ETA та статус пошуку допомоги."],
  ["⚡", "Швидкий матчинг", "Заявка йде перевіреним виконавцям у радіусі, а перший підтверджений бере роботу."],
  ["₴", "Прозора оцінка ціни", "Перед викликом показуємо орієнтовну вартість з подачею, маршрутом і послугою."],
  ["🚛", "Кабінет партнера", "Партнер виходить на лінію, приймає заявку та оновлює статус прямо з телефону."],
  ["🧭", "Navigation Bridge", "Партнер може відкривати Google Maps або Waze, а POMICH тримає ETA і статус у клієнтському екрані."],
  ["🔌", "OpenRoadAid API", "Roadside-шар для інтеграцій: incident, matching, assignment, EN_ROUTE, ARRIVED, COMPLETED."],
] as const

const landingSteps = [
  ["1", "Оберіть проблему", "Евакуатор, акумулятор, колесо, пальне, замок або інша несправність."],
  ["2", "Підтвердьте місце", "Карта підставляє координати, а клієнт може уточнити точку вручну."],
  ["3", "Отримайте ETA і ціну", "POMICH показує приблизний час прибуття та вартість до підтвердження."],
  ["4", "Стежте за допомогою", "Виконавець приймає заявку, їде до клієнта й оновлює статус роботи."],
] as const

type LandingThemeMode = "dark" | "light"

const landingThemes = {
  dark: {
    page: "#090B0E",
    section: "#090B0E",
    sectionAlt: "#0D1015",
    nav: "rgba(9,11,14,0.88)",
    navBorder: "rgba(255,255,255,0.08)",
    text: "#FFFFFF",
    muted: "#B9C2D0",
    subtle: "#AAB4C3",
    navText: "#9CA3AF",
    badgeBg: "rgba(22,163,106,0.12)",
    badgeBorder: "rgba(22,163,106,0.38)",
    badgeText: "#8EF0BE",
    card: "rgba(255,255,255,0.045)",
    cardStrong: "linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))",
    cardBorder: "rgba(255,255,255,0.13)",
    cardShadow: "0 20px 70px rgba(0,0,0,0.26)",
    clientCard: "rgba(15,18,22,0.92)",
    clientItem: "rgba(255,255,255,0.06)",
    clientItemBorder: "rgba(255,255,255,0.1)",
    partnerCard: "rgba(255,255,255,0.92)",
    partnerText: DARK,
    partnerMuted: "#6B7280",
    ghostBg: "rgba(255,255,255,0.08)",
    ghostBorder: "rgba(255,255,255,0.16)",
    footer: "#090B0E",
    menu: "rgba(15,18,22,0.98)",
    heroOverlay: "radial-gradient(circle at 50% 26%, rgba(22,163,106,0.18), rgba(9,11,14,0.18) 34%, #090B0E 78%), linear-gradient(180deg, rgba(9,11,14,0.58), rgba(9,11,14,0.96))",
    mapOverlay: "linear-gradient(180deg, rgba(9,11,14,0.06), rgba(9,11,14,0.28))",
    toggleTrack: "rgba(255,255,255,0.08)",
    toggleBorder: "rgba(255,255,255,0.14)",
    toggleKnob: "#FFFFFF",
  },
  light: {
    page: "#F5F8FB",
    section: "#F5F8FB",
    sectionAlt: "#EAF2F7",
    nav: "rgba(255,255,255,0.9)",
    navBorder: "#DDE5EF",
    text: "#0F172A",
    muted: "#475569",
    subtle: "#64748B",
    navText: "#475569",
    badgeBg: "#EAFBF2",
    badgeBorder: "#A8EBC7",
    badgeText: "#0B7A4D",
    card: "#FFFFFF",
    cardStrong: "#FFFFFF",
    cardBorder: "#DDE5EF",
    cardShadow: "0 18px 44px rgba(15,23,42,0.08)",
    clientCard: "#FFFFFF",
    clientItem: "#F3F7FA",
    clientItemBorder: "#DDE5EF",
    partnerCard: "#FFFFFF",
    partnerText: "#0F172A",
    partnerMuted: "#64748B",
    ghostBg: "#FFFFFF",
    ghostBorder: "#DDE5EF",
    footer: "#EEF4F8",
    menu: "rgba(255,255,255,0.98)",
    heroOverlay: "radial-gradient(circle at 50% 26%, rgba(22,163,106,0.16), rgba(245,248,251,0.2) 34%, #F5F8FB 80%), linear-gradient(180deg, rgba(245,248,251,0.32), rgba(245,248,251,0.96))",
    mapOverlay: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.16))",
    toggleTrack: "#E2E8F0",
    toggleBorder: "#CBD5E1",
    toggleKnob: "#FFFFFF",
  },
} as const

type LandingTheme = (typeof landingThemes)[LandingThemeMode]

function getInitialLandingTheme(): LandingThemeMode {
  if (typeof window === "undefined") return "dark"
  const stored = window.localStorage.getItem("pomichLandingTheme")
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"
}

function LandingBadge({ label, theme }: { label: string; theme: LandingTheme }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${theme.badgeBorder}`, background: theme.badgeBg, color: theme.badgeText, borderRadius: 999, padding: "8px 12px", fontWeight: 900, fontSize: 13 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "#22C55E", boxShadow: "0 0 18px rgba(34,197,94,0.85)" }} />
      {label}
    </span>
  )
}

function LandingButton({ children, onClick, theme, variant = "primary" }: { children: React.ReactNode; onClick?: () => void; theme: LandingTheme; variant?: "primary" | "secondary" | "ghost" }) {
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"
  return (
    <button
      onClick={onClick}
      style={{
        minHeight: 50,
        border: isGhost ? `1px solid ${theme.ghostBorder}` : "none",
        borderRadius: 12,
        padding: "0 18px",
        background: isPrimary ? "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)" : isGhost ? theme.ghostBg : "linear-gradient(135deg, #2F80ED 0%, #D6B400 100%)",
        color: isGhost ? theme.text : "#fff",
        boxShadow: isGhost ? "none" : "0 16px 38px rgba(22,163,106,0.22)",
        fontFamily: "inherit",
        fontWeight: 950,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  )
}

function LandingSectionTitle({ eyebrow, title, subtitle, theme }: { eyebrow: string; title: string; subtitle: string; theme: LandingTheme }) {
  return (
    <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto 34px" }}>
      <div style={{ display: "inline-flex", border: "1px solid rgba(47,128,237,0.42)", background: "rgba(47,128,237,0.14)", color: "#69A7FF", borderRadius: 999, padding: "7px 12px", fontWeight: 900, fontSize: 13 }}>{eyebrow}</div>
      <h2 style={{ margin: "18px 0 0", color: theme.text, fontSize: "clamp(32px, 5vw, 52px)", lineHeight: 1.03, letterSpacing: 0, fontWeight: 950 }}>{title}</h2>
      <p style={{ margin: "14px auto 0", color: theme.muted, fontSize: 17, lineHeight: 1.55, fontWeight: 700 }}>{subtitle}</p>
    </div>
  )
}

function LandingThemeToggle({ mode, theme, compact, onToggle }: { mode: LandingThemeMode; theme: LandingTheme; compact: boolean; onToggle: () => void }) {
  const isLight = mode === "light"
  const width = compact ? 92 : 132
  const knobWidth = compact ? 42 : 62

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!isLight}
      aria-label="Перемкнути тему лендингу"
      onClick={onToggle}
      style={{ width, height: 42, border: `1px solid ${theme.toggleBorder}`, borderRadius: 999, background: theme.toggleTrack, color: theme.text, position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", alignItems: "center", padding: 4, fontFamily: "inherit", fontSize: compact ? 11 : 12, fontWeight: 950, cursor: "pointer", boxShadow: mode === "light" ? "0 8px 24px rgba(15,23,42,0.08)" : "none" }}
    >
      <span style={{ position: "absolute", top: 4, bottom: 4, left: isLight ? 4 : width - knobWidth - 4, width: knobWidth, borderRadius: 999, background: theme.toggleKnob, boxShadow: "0 6px 18px rgba(0,0,0,0.18)", transition: "left 0.2s ease" }} />
      <span style={{ position: "relative", zIndex: 1, color: isLight ? DARK : theme.navText }}>{compact ? "Світ" : "Світла"}</span>
      <span style={{ position: "relative", zIndex: 1, color: isLight ? theme.navText : DARK }}>{compact ? "Тем" : "Темна"}</span>
    </button>
  )
}

function LandingInterfacePreview({ compact, theme }: { compact: boolean; theme: LandingTheme }) {
  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gridTemplateColumns: compact ? "1fr" : "300px minmax(0, 1fr) 300px", gap: compact ? 16 : 22, alignItems: "stretch" }}>
      <div style={{ order: compact ? 2 : 1, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.clientCard, boxShadow: theme.cardShadow, padding: 16, color: theme.text, alignSelf: "center" }}>
        <div style={{ color: theme.badgeText, fontWeight: 950, fontSize: 13 }}>Клієнтський сценарій</div>
        <div style={{ marginTop: 8, fontSize: 23, lineHeight: 1.08, fontWeight: 950, color: theme.text }}>Потрібна допомога на дорозі?</div>
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {["Поточне місце", "Евакуатор", "Орієнтовно 12 хв"].map((item, index) => (
            <div key={item} style={{ display: "grid", gridTemplateColumns: "32px 1fr", alignItems: "center", gap: 10, border: `1px solid ${theme.clientItemBorder}`, borderRadius: 8, padding: "9px 10px", background: theme.clientItem }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: index === 0 ? "rgba(22,163,106,0.22)" : "rgba(47,128,237,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>{index === 0 ? "●" : index === 1 ? "🚛" : "⚡"}</span>
              <span style={{ fontWeight: 900, fontSize: 13 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ order: compact ? 1 : 2, position: "relative", height: compact ? 360 : 500, borderRadius: 24, overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "0 28px 90px rgba(0,0,0,0.38)", background: "#14181D", minWidth: 0 }}>
        <RouteMap pickup={LANDING_PICKUP} destination={LANDING_DESTINATION} providers={landingProviders} subtitle="Київ · live dispatch" full />
        <div style={{ position: "absolute", inset: 0, background: theme.mapOverlay, pointerEvents: "none", zIndex: 1150 }} />
      </div>

      <div style={{ order: 3, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.partnerCard, color: theme.partnerText, boxShadow: theme.cardShadow, padding: 16, alignSelf: "center" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 950 }}>Партнер POMICH</div>
            <div style={{ color: theme.partnerMuted, fontSize: 12, fontWeight: 800, marginTop: 3 }}>На лінії · 1.7 км</div>
          </div>
          <div style={{ color: BRAND, background: "#E8F8F1", borderRadius: 999, padding: "7px 10px", fontWeight: 950, fontSize: 12 }}>~12 хв</div>
        </div>
        <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: "#E5E7EB" }}>
          <div style={{ width: "68%", height: "100%", borderRadius: 999, background: BRAND }} />
        </div>
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ borderRadius: 8, background: "#F3F4F6", padding: 10, fontSize: 12, fontWeight: 900 }}>Прийнято</div>
          <div style={{ borderRadius: 8, background: "#111315", color: "#fff", padding: 10, fontSize: 12, fontWeight: 900 }}>У дорозі</div>
        </div>
      </div>
    </div>
  )
}

function LandingPage({ onSelect }: { onSelect: (role: Role) => void }) {
  const compact = useMediaQuery("(max-width: 760px)")
  const [menuOpen, setMenuOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<LandingThemeMode>(getInitialLandingTheme)
  const theme = landingThemes[themeMode]
  const navItems = [
    ["#home", "Головна"],
    ["#interface", "Інтерфейс"],
    ["#features", "Функції"],
    ["#steps", "Як це працює"],
    ["#contacts", "Контакти"],
  ] as const

  useEffect(() => {
    window.localStorage.setItem("pomichLandingTheme", themeMode)
  }, [themeMode])

  return (
    <div style={{ minHeight: "100vh", background: theme.page, color: theme.text, overflowX: "hidden", transition: "background 0.2s ease, color 0.2s ease" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 2200, height: 66, borderBottom: `1px solid ${theme.navBorder}`, background: theme.nav, backdropFilter: "blur(18px)", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? "0 16px" : "0 28px" }}>
        <div style={{ width: "100%", maxWidth: 1070, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
          <a href="#home" style={{ display: "inline-flex", alignItems: "center", gap: 12, color: theme.text, textDecoration: "none", fontWeight: 950 }}>
            <span style={{ width: 42, height: 42, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", boxShadow: "0 12px 32px rgba(22,163,106,0.28)", fontSize: 20 }}>P</span>
            <span style={{ fontSize: 20 }}>POMICH</span>
          </a>
          {compact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LandingThemeToggle mode={themeMode} theme={theme} compact={compact} onToggle={() => setThemeMode((mode) => mode === "dark" ? "light" : "dark")} />
              <button aria-label="Меню" onClick={() => setMenuOpen((value) => !value)} style={{ width: 44, height: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 10, background: theme.ghostBg, color: theme.text, fontSize: 24, fontWeight: 900, cursor: "pointer" }}>☰</button>
            </div>
          ) : (
            <nav style={{ display: "flex", alignItems: "center", gap: 26 }}>
              {navItems.map(([href, label]) => (
                <a key={href} href={href} style={{ color: theme.navText, textDecoration: "none", fontWeight: 850, fontSize: 14 }}>{label}</a>
              ))}
            </nav>
          )}
          {!compact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <LandingThemeToggle mode={themeMode} theme={theme} compact={compact} onToggle={() => setThemeMode((mode) => mode === "dark" ? "light" : "dark")} />
              <LandingButton theme={theme} onClick={() => onSelect("customer")}>Відкрити Web</LandingButton>
            </div>
          ) : null}
        </div>
        {compact && menuOpen ? (
          <div style={{ position: "absolute", top: 66, left: 12, right: 12, border: `1px solid ${theme.ghostBorder}`, borderRadius: 8, background: theme.menu, padding: 12, display: "grid", gap: 4, boxShadow: "0 24px 60px rgba(0,0,0,0.32)" }}>
            {navItems.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ color: theme.text, textDecoration: "none", fontWeight: 900, padding: "12px 10px", borderRadius: 6 }}>{label}</a>
            ))}
          </div>
        ) : null}
      </header>

      <main>
        <section id="home" style={{ position: "relative", minHeight: compact ? "600px" : "680px", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? "40px 18px 24px" : "72px 24px 48px", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, opacity: 0.36, filter: "saturate(1.18) contrast(1.05)" }}>
            <RouteMap pickup={LANDING_PICKUP} destination={LANDING_DESTINATION} providers={landingProviders} subtitle="POMICH live map" full showBadges={false} />
          </div>
          <div style={{ position: "absolute", inset: 0, background: theme.heroOverlay }} />
          <div style={{ position: "relative", zIndex: 2, width: "100%", maxWidth: 960, textAlign: "center" }}>
            <LandingBadge label="Український roadside assistance marketplace" theme={theme} />
            <h1 style={{ margin: compact ? "18px 0 0" : "28px 0 0", fontSize: compact ? 40 : "clamp(42px, 7.4vw, 84px)", lineHeight: 0.98, letterSpacing: 0, fontWeight: 950 }}>
              POMICH —<br />
              <span style={{ background: "linear-gradient(90deg, #8EF0BE 0%, #69A7FF 52%, #FACC15 100%)", WebkitBackgroundClip: "text", color: "transparent" }}>допомога поруч</span>
            </h1>
            <p style={{ margin: compact ? "18px auto 0" : "24px auto 0", maxWidth: 720, color: theme.muted, fontSize: compact ? 16 : 21, lineHeight: compact ? 1.46 : 1.55, fontWeight: 700 }}>
              Викликайте евакуатор, запуск акумулятора, колесо, пальне або механіка так само швидко, як поїздку: точка на карті, ETA, ціна і перевірений партнер.
            </p>
            <div style={{ margin: compact ? "22px auto 0" : "30px auto 0", color: theme.badgeText, fontSize: 13, fontWeight: 950 }}>Оберіть вашу роль</div>
            <div style={{ margin: "12px auto 0", display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(3, minmax(180px, 1fr))", gap: compact ? 10 : 12, maxWidth: 760 }}>
              <LandingButton theme={theme} onClick={() => onSelect("customer")}>Викликати допомогу</LandingButton>
              <LandingButton theme={theme} variant="secondary" onClick={() => onSelect("provider")}>Прийняти заявку</LandingButton>
              <a href="#interface" style={{ textDecoration: "none" }}><LandingButton theme={theme} variant="ghost">Подивитися інтерфейс</LandingButton></a>
            </div>
            <div style={{ margin: compact ? "24px auto 0" : "46px auto 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: compact ? 10 : 28, maxWidth: 680 }}>
              {landingStats.map(([value, label]) => (
                <div key={value} style={{ borderLeft: compact ? "none" : "1px solid rgba(255,255,255,0.14)", padding: compact ? "0 4px" : "0 24px" }}>
                  <div style={{ color: "#FACC15", fontSize: compact ? 26 : 38, fontWeight: 950 }}>{value}</div>
                  <div style={{ marginTop: 6, color: theme.subtle, fontSize: compact ? 11 : 13, fontWeight: 800 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="interface" style={{ padding: compact ? "54px 16px 72px" : "76px 24px 96px", background: theme.section }}>
          <LandingSectionTitle eyebrow="Інтерфейс" title="Як виглядає POMICH" subtitle="Карта, заявка і статуси залишаються на одному екрані: клієнт бачить допомогу, партнер бачить роботу, диспетчер бачить процес." theme={theme} />
          <LandingInterfacePreview compact={compact} theme={theme} />
        </section>

        <section id="features" style={{ padding: compact ? "48px 16px 64px" : "74px 24px 90px", background: theme.sectionAlt }}>
          <LandingSectionTitle eyebrow="Функції" title="Все, що потрібно для допомоги на дорозі" subtitle="POMICH зшиває клієнта, виконавця і диспетчера в один короткий, зрозумілий процес." theme={theme} />
          <div style={{ maxWidth: 1070, margin: "0 auto", display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(3, 1fr)", gap: 24 }}>
            {landingFeatures.map(([icon, title, text], index) => (
              <div key={title} style={{ minHeight: 218, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: index < 2 ? theme.cardStrong : theme.card, padding: 28, boxShadow: themeMode === "light" ? "0 12px 32px rgba(15,23,42,0.05)" : "none" }}>
                {index < 3 ? <div style={{ float: "right", borderRadius: 999, padding: "7px 11px", background: "#FACC15", color: "#111315", fontSize: 12, fontWeight: 950 }}>Нове</div> : null}
                <div style={{ fontSize: 28 }}>{icon}</div>
                <h3 style={{ margin: "24px 0 0", color: theme.text, fontSize: 20, lineHeight: 1.18, fontWeight: 950 }}>{title}</h3>
                <p style={{ margin: "12px 0 0", color: theme.muted, fontSize: 15, lineHeight: 1.55, fontWeight: 700 }}>{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="steps" style={{ padding: compact ? "56px 16px 70px" : "80px 24px 100px", background: theme.section }}>
          <LandingSectionTitle eyebrow="Як це працює" title="Чотири кроки до допомоги" subtitle="Короткий сценарій для стресової ситуації: без зайвих форм і без телефонних списків." theme={theme} />
          <div style={{ maxWidth: 700, margin: "0 auto", display: "grid", gap: 0 }}>
            {landingSteps.map(([number, title, text], index) => (
              <div key={number} style={{ display: "grid", gridTemplateColumns: compact ? "54px 1fr" : "74px 1fr", gap: compact ? 16 : 24, position: "relative", paddingBottom: index === landingSteps.length - 1 ? 0 : 34 }}>
                {index < landingSteps.length - 1 ? <div style={{ position: "absolute", left: compact ? 26 : 36, top: 54, bottom: 0, width: 2, background: theme.cardBorder }} /> : null}
                <div style={{ width: compact ? 54 : 62, height: compact ? 54 : 62, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950, boxShadow: "0 0 0 6px rgba(47,128,237,0.16)", zIndex: 1 }}>{number}</div>
                <div style={{ paddingTop: 4 }}>
                  <h3 style={{ margin: 0, color: theme.text, fontSize: compact ? 19 : 22, fontWeight: 950 }}>{title}</h3>
                  <p style={{ margin: "10px 0 0", color: theme.muted, fontSize: 16, lineHeight: 1.55, fontWeight: 700 }}>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="contacts" style={{ padding: compact ? "56px 16px 72px" : "82px 24px 96px", background: `radial-gradient(circle at 50% 0%, rgba(22,163,106,0.18), transparent 34%), ${theme.sectionAlt}`, textAlign: "center" }}>
          <LandingSectionTitle eyebrow="Спільнота" title="Підключаємо водіїв і партнерів по Україні" subtitle="Клієнти отримують швидку допомогу, партнери отримують прозорі заявки, диспетчер має контроль над якістю." theme={theme} />
          <div style={{ maxWidth: 820, margin: "0 auto", display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(2, 1fr)", gap: 14 }}>
            <button onClick={() => onSelect("customer")} style={{ minHeight: 74, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.card, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: "14px 18px", fontWeight: 950, boxShadow: themeMode === "light" ? "0 12px 32px rgba(15,23,42,0.05)" : "none" }}>
              <span style={{ display: "block", color: "#8EF0BE", fontSize: 13 }}>Водіям</span>
              <span style={{ display: "block", marginTop: 4, fontSize: 18 }}>Відкрити клієнтський Web</span>
            </button>
            <button onClick={() => onSelect("provider")} style={{ minHeight: 74, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, background: theme.card, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: "14px 18px", fontWeight: 950, boxShadow: themeMode === "light" ? "0 12px 32px rgba(15,23,42,0.05)" : "none" }}>
              <span style={{ display: "block", color: "#69A7FF", fontSize: 13 }}>Партнерам</span>
              <span style={{ display: "block", marginTop: 4, fontSize: 18 }}>Вийти на лінію</span>
            </button>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: `1px solid ${theme.navBorder}`, background: theme.footer, padding: compact ? "22px 16px" : "28px 24px" }}>
        <div style={{ maxWidth: 1070, margin: "0 auto", display: "flex", flexDirection: compact ? "column" : "row", justifyContent: "space-between", gap: 16, color: theme.navText, fontSize: 13, fontWeight: 800 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950 }}>P</span>
            <span>POMICH для України</span>
          </div>
          <div>© 2026. Roadside assistance, built around fast verified help.</div>
        </div>
      </footer>
    </div>
  )
}

function CustomerFlow() {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const initialCustomerId = useMemo(() => {
    if (telegramContext.chatId) return `tg-${telegramContext.chatId}`
    if (typeof window === "undefined") return "customer-web"
    return window.sessionStorage.getItem("pomichCustomerId") || "customer-web"
  }, [telegramContext.chatId])
  const [customerId, setCustomerId] = useState(initialCustomerId)
  const [customerAccessToken, setCustomerAccessToken] = useState<string | undefined>(() => readStoredAuthSession(authSessionStorageKey("customer", initialCustomerId), "customer", initialCustomerId))
  const customerAuthToken = customerAccessToken
  const [screen, setScreen] = useState<Screen>("home")
  const [selectedService, setSelectedService] = useState<ServiceKey>("tow")
  const [destination, setDestination] = useState("СТО «Авторемонт»")
  const [vehicleState, setVehicleState] = useState("Авто заводиться")
  const [loading, setLoading] = useState(false)
  const [orderId, setOrderId] = useState<string | undefined>()
  const [currentOrder, setCurrentOrder] = useState<OrderResponse | undefined>()
  const [status, setStatus] = useState<OrderStatus>("draft")
  const [geoState, setGeoState] = useState<GeoState>("requesting")
  const [geoMessage, setGeoMessage] = useState("Визначаємо ваше місцезнаходження…")
  const [pickup, setPickup] = useState<Point>(PICKUP)
  const [destinationPoint, setDestinationPoint] = useState<Point>(DEFAULT_DESTINATION)
  const [trackingProgress, setTrackingProgress] = useState(12)
  const [nearbyProviders, setNearbyProviders] = useState<ProviderAvailability[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile>({
    id: customerId,
    name: telegramContext.user?.first_name ? `${telegramContext.user.first_name}${telegramContext.user.last_name ? ` ${telegramContext.user.last_name}` : ""}` : "Клієнт POMICH",
    phone: "",
    telegram: telegramContext.user?.username,
    city: "Київ",
    rating: 5,
    ordersCompleted: 0,
    verificationStatus: "unverified",
    trustedBadges: ["Телефон", "Профіль"],
    profileCompleteness: telegramContext.user?.username ? 62 : 45,
  })
  const [customerVerificationSaving, setCustomerVerificationSaving] = useState(false)
  const [customerVerificationError, setCustomerVerificationError] = useState<string | undefined>()

  const orderInput: CustomerOrderInput = {
    service: selectedService,
    customerLocation: "вул. Собранецька, Ужгород",
    destination,
    distanceKm: calculateDistanceKm(pickup, destinationPoint),
  }

  const applyCustomerSession = (session: AuthSession) => {
    const nextCustomerId = session.customerId ?? session.subjectId
    if (!nextCustomerId || !session.accessToken) return
    setCustomerId(nextCustomerId)
    setCustomerAccessToken(session.accessToken)
    storeAuthSession(authSessionStorageKey("customer", nextCustomerId), session)
    if (typeof window !== "undefined") window.sessionStorage.setItem("pomichCustomerId", nextCustomerId)
    if (session.profile) setCustomerProfile((profile) => ({ ...profile, ...session.profile, id: nextCustomerId }))
  }

  const ensureCustomerSession = async () => {
    if (customerAuthToken) return { customerId, token: customerAuthToken }
    const session = telegramContext.initData
      ? await createTelegramCustomerSession(telegramContext.initData)
      : await createGuestCustomerSession(customerId === "customer-web" || customerId.startsWith("guest-") ? customerId : undefined)
    applyCustomerSession(session)
    return { customerId: session.customerId ?? session.subjectId, token: session.accessToken }
  }

  useEffect(() => {
    telegramContext.webApp?.ready?.()
    telegramContext.webApp?.expand?.()
  }, [telegramContext.webApp])

  useEffect(() => {
    if (!telegramContext.initData) return
    let cancelled = false

    createTelegramCustomerSession(telegramContext.initData)
      .then((session) => {
        if (!cancelled) applyCustomerSession(session)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [telegramContext.initData])

  useEffect(() => {
    if (!telegramContext.chatId || !telegramContext.initData) return

    getTelegramSession(telegramContext.chatId, telegramContext.initData)
      .then((session) => {
        if (session.customerId) setCustomerId(session.customerId)
        if (session.profile) setCustomerProfile((profile) => ({ ...profile, ...session.profile, id: session.customerId ?? profile.id }))
        if (!session.location) return
        setPickup({ lat: session.location.latitude, lng: session.location.longitude })
        setGeoState("telegram")
        setGeoMessage("Геолокацію отримано з Telegram.")
      })
      .catch(() => {
        setGeoMessage("Не вдалося синхронізувати геолокацію з Telegram.")
      })
  }, [telegramContext.chatId, telegramContext.initData])

  useEffect(() => {
    if (geoState === "telegram") return
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoState("unavailable")
      setGeoMessage("Не вдалося визначити геолокацію.")
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPickup({ lat: position.coords.latitude, lng: position.coords.longitude })
        setGeoState("success")
        setGeoMessage("Місцезнаходження визначено.")
      },
      () => {
        setGeoState("permission-denied")
        setGeoMessage("Не вдалося визначити геолокацію. Можна вибрати точку вручну.")
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [geoState])

  useEffect(() => {
    let cancelled = false
    const refreshProviders = () => {
      setProvidersLoading(true)
      getProviders()
        .then((items) => {
          if (!cancelled) setNearbyProviders(Array.isArray(items) ? items : [])
        })
        .catch(() => {
          if (!cancelled) setNearbyProviders([])
        })
        .finally(() => {
          if (!cancelled) setProvidersLoading(false)
        })
    }

    refreshProviders()
    const interval = window.setInterval(refreshProviders, 10000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!orderId || status === "completed" || status === "cancelled") return
    let cancelled = false

    const refreshOrder = () => {
      getOrder(orderId)
        .then((order) => {
          if (cancelled) return
          setCurrentOrder(order)
          const nextStatus = normalizeOrderStatus(order.status)
          setStatus(nextStatus)
          setScreen(screenForOrderStatus(nextStatus))
        })
        .catch(() => undefined)
    }

    refreshOrder()
    const interval = window.setInterval(refreshOrder, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [orderId, status])

  useEffect(() => {
    if (screen !== "tracking") return
    const interval = window.setInterval(() => {
      setTrackingProgress((value) => Math.min(100, value + 7))
    }, 1200)
    return () => window.clearInterval(interval)
  }, [screen])

  const serviceLabel = useMemo(() => services.find((item) => item.key === selectedService)?.label ?? "Евакуатор", [selectedService])
  const distanceKm = useMemo(() => calculateDistanceKm(pickup, destinationPoint), [pickup, destinationPoint])
  const breakdown = useMemo(() => calculatePrice(selectedService, distanceKm), [distanceKm, selectedService])

  const setDestinationFromMap = (point: Point) => {
    setDestinationPoint(point)
    setDestination(`Точка на карті ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`)
  }

  const submitOrder = async () => {
    setLoading(true)
    try {
      const fromTelegram = Boolean(telegramContext.initData)
      const customerSession = await ensureCustomerSession()
      const payload = {
        source: fromTelegram ? "telegram-mini-app" : "web",
        customerId: customerSession.customerId,
        service: selectedService,
        customerLocation: geoState === "success" || geoState === "telegram" ? "Поточна геолокація клієнта" : sanitizeLocation(orderInput.customerLocation),
        customerCoordinates: pickup,
        destination: sanitizeLocation(destination),
        destinationCoordinates: destinationPoint,
        vehicleState,
        distanceKm: breakdown.distanceKm,
        notify: Boolean(telegramContext.chatId && telegramContext.initData),
        chatId: telegramContext.chatId,
        telegramInitData: telegramContext.initData,
        telegramUserId: telegramContext.user?.id,
        telegramUsername: telegramContext.user?.username,
        telegramFirstName: telegramContext.user?.first_name,
        status: "searching",
      }

      const errors = validateCustomerOrderInput({
        service: selectedService,
        customerLocation: payload.customerLocation,
        destination: payload.destination,
        distanceKm: payload.distanceKm,
      })

      if (errors.length > 0) {
        throw new Error("Validation failed")
      }

      const response = await createOrder(payload, customerSession.token)
      setOrderId(response.id)
      setCurrentOrder(response)
      setStatus(normalizeOrderStatus(response.status ?? "searching"))
      setScreen("searching")
    } catch {
      setScreen("error")
    } finally {
      setLoading(false)
    }
  }

  const cancelOrder = () => {
    setStatus("cancelled")
    setScreen("cancelled")
    if (orderId) cancelOrderRequest(orderId).catch(() => undefined)
  }

  const retryOrderDispatch = () => {
    if (!orderId) return
    retryDispatch(orderId)
      .then((order) => {
        setCurrentOrder(order)
        setStatus(normalizeOrderStatus(order.status))
      })
      .catch(() => undefined)
  }

  const verifyCustomerProfile = async () => {
    setCustomerVerificationSaving(true)
    setCustomerVerificationError(undefined)
    try {
      const customerSession = await ensureCustomerSession()
      const savedProfile = await updateCustomerProfile(customerSession.customerId, {
        name: customerProfile.name,
        phone: customerProfile.phone,
        telegram: customerProfile.telegram,
        city: customerProfile.city,
      }, customerSession.token)
      const submitted = await submitCustomerVerification(customerSession.customerId, {
        phone: Boolean(savedProfile.phone),
        telegram: Boolean(savedProfile.telegram),
        profilePhoto: true,
        trustedContacts: true,
        identityDocumentRef: `pomich/${customerSession.customerId}/identity`,
      }, customerSession.token)
      setCustomerProfile((profile) => ({ ...profile, ...submitted }))
    } catch {
      setCustomerVerificationError("Не вдалося відправити профіль на перевірку.")
    } finally {
      setCustomerVerificationSaving(false)
    }
  }

  const startTracking = () => {
    setTrackingProgress(12)
    setScreen("tracking")
  }

  const completeOrder = () => {
    setScreen("in_progress")
  }

  const restart = () => {
    setScreen("home")
    setStatus("draft")
    setOrderId(undefined)
    setCurrentOrder(undefined)
    setTrackingProgress(12)
  }

  switch (screen) {
    case "location":
      return <LocationStep pickup={pickup} geoMessage={geoMessage} onPick={(point) => { setPickup(point); setGeoState("success"); setGeoMessage("Місце подачі оновлено вручну.") }} onBack={() => setScreen("home")} onNext={() => setScreen("destination")} />
    case "destination":
      return <DestinationStep pickup={pickup} destination={destinationPoint} value={destination} onPick={setDestinationFromMap} onChange={setDestination} onBack={() => setScreen("location")} onNext={() => setScreen("details")} />
    case "details":
      return <DetailsStep pickup={pickup} destination={destinationPoint} value={vehicleState} onChange={setVehicleState} onBack={() => setScreen("destination")} onNext={() => setScreen("price")} />
    case "price":
      return <PriceStep serviceLabel={serviceLabel} breakdown={breakdown} pickup={pickup} destination={destinationPoint} loading={loading} onConfirm={submitOrder} onBack={() => setScreen("details")} />
    case "searching":
      return <SearchingStep orderId={orderId} status={status} order={currentOrder} onCancel={cancelOrder} onRetryDispatch={retryOrderDispatch} />
    case "assigned":
      return <AssignedStep orderId={orderId} status={status} order={currentOrder} onTrack={startTracking} onCancel={cancelOrder} />
    case "tracking":
      return <TrackingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} progress={trackingProgress} onCancel={cancelOrder} />
    case "arrived":
      return <ArrivedStep orderId={orderId} status={status} order={currentOrder} onComplete={completeOrder} onCancel={cancelOrder} />
    case "in_progress":
      return <InProgressStep orderId={orderId} status={status} order={currentOrder} onCancel={cancelOrder} />
    case "completed":
      return <FinalStep orderId={orderId} status="completed" onRestart={restart} />
    case "cancelled":
      return <FinalStep orderId={orderId} status="cancelled" onRestart={restart} />
    case "error":
      return <ErrorStep onRetry={() => setScreen("price")} />
    case "home":
    default:
      return <HomeStep pickup={pickup} locationLabel={geoMessage} providers={nearbyProviders} providersLoading={providersLoading} customerProfile={customerProfile} customerVerificationSaving={customerVerificationSaving} customerVerificationError={customerVerificationError} onVerifyCustomer={verifyCustomerProfile} onSelect={(service) => { setSelectedService(service); setScreen("location") }} />
  }
}

function ProviderFlow({ providerToken }: { providerToken?: string }) {
  const providerId = useMemo(() => getActiveProviderId(), [])
  const providerSessionStorageKey = useMemo(() => authSessionStorageKey("provider", providerId), [providerId])
  const [providerAccessToken, setProviderAccessToken] = useState<string | undefined>(() => {
    if (isAuthSessionToken(providerToken)) return providerToken
    return readStoredAuthSession(authSessionStorageKey("provider", getActiveProviderId()), "provider", getActiveProviderId())
  })
  const providerAuthToken = providerAccessToken
  const [authError, setAuthError] = useState<string | undefined>()
  const [accountLogin, setAccountLogin] = useState(providerId)
  const [accountPassword, setAccountPassword] = useState("")
  const [authSaving, setAuthSaving] = useState(false)
  const [step, setStep] = useState<"register" | "duty" | "offer" | "navigation" | "arrived" | "completed">(() => {
    if (typeof window === "undefined") return "register"
    return window.localStorage.getItem(`pomichPartnerRegistered:${getActiveProviderId()}`) ? "duty" : "register"
  })
  const [onDuty, setOnDuty] = useState(false)
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [registrationSaving, setRegistrationSaving] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | undefined>()
  const [incomingOffers, setIncomingOffers] = useState<DispatchOffer[]>([])
  const [activeOrder, setActiveOrder] = useState<OrderResponse | undefined>()
  const [offerError, setOfferError] = useState<string | undefined>()
  const [offerSaving, setOfferSaving] = useState(false)
  const [offerClock, setOfferClock] = useState(Date.now())
  const [progress, setProgress] = useState(18)
  const [providerLocation, setProviderLocation] = useState<Point>(PROVIDER_START)
  const [providerProfile, setProviderProfile] = useState<ProviderAvailability>({
    id: providerId,
    name: provider.name,
    rating: provider.rating,
    vehicle: provider.vehicle,
    plate: provider.plate,
    phone: provider.phone,
    telegram: provider.telegram,
    status: "offline",
    etaMinutes: provider.etaMinutes,
    location: PROVIDER_START,
    specialties: ["tow", "battery", "wheel"],
    serviceRadiusKm: 7,
  })
  const [registrationForm, setRegistrationForm] = useState<PartnerRegistrationForm>({
    name: provider.name,
    phone: provider.phone,
    telegram: provider.telegram,
    vehicle: provider.vehicle,
    plate: provider.plate,
    specialties: ["tow", "battery", "wheel"],
    serviceRadiusKm: 7,
    identityDocumentRef: "",
    driverLicenseRef: "",
    vehicleRegistrationRef: "",
    serviceProofRef: "",
    selfieRef: "",
  })
  const pickup = PICKUP
  const destination = DEFAULT_DESTINATION
  const providerSpecialties = toServiceKeys(providerProfile.specialties)
  const providerPresence: ProviderAvailability = {
    id: providerId,
    name: providerProfile.name || provider.name,
    rating: providerProfile.rating ?? provider.rating,
    vehicle: providerProfile.vehicle || provider.vehicle,
    plate: providerProfile.plate || provider.plate,
    phone: providerProfile.phone || provider.phone,
    telegram: providerProfile.telegram || provider.telegram,
    status: onDuty ? "online" : "offline",
    etaMinutes: providerProfile.etaMinutes ?? provider.etaMinutes,
    location: providerLocation,
    specialties: providerSpecialties.length > 0 ? providerSpecialties : registrationForm.specialties,
    serviceRadiusKm: providerProfile.serviceRadiusKm ?? registrationForm.serviceRadiusKm,
    verificationStatus: providerProfile.verificationStatus,
    trustedBadges: providerProfile.trustedBadges,
  }
  const providerCanGoOnline = isVerified(providerProfile.verificationStatus)

  useEffect(() => {
    if (providerAuthToken) return

    if (!providerToken) {
      setAuthError("РџР°СЂС‚РЅРµСЂСЃСЊРєР° СЃРµСЃС–СЏ РЅРµ РІС–РґРєСЂРёС‚Р°. РџРѕС‚СЂС–Р±РµРЅ РґРѕСЃС‚СѓРї РІС–Рґ РґРёСЃРїРµС‚С‡РµСЂР°.")
      return
    }

    if (isAuthSessionToken(providerToken)) {
      if (typeof window !== "undefined") window.sessionStorage.setItem(providerSessionStorageKey, providerToken)
      setProviderAccessToken(providerToken)
      setAuthError(undefined)
      return
    }

    let cancelled = false
    createProviderSession(providerId, providerToken)
      .then((session) => {
        if (cancelled) return
        storeAuthSession(providerSessionStorageKey, session)
        setProviderAccessToken(session.accessToken)
        setAuthError(undefined)
      })
      .catch(() => {
        if (!cancelled) setAuthError("РќРµ РІРґР°Р»РѕСЃСЏ РІС–РґРєСЂРёС‚Рё Р·Р°С…РёС‰РµРЅСѓ СЃРµСЃС–СЋ РїР°СЂС‚РЅРµСЂР°.")
      })

    return () => {
      cancelled = true
    }
  }, [providerAuthToken, providerId, providerSessionStorageKey, providerToken])

  useEffect(() => {
    let cancelled = false

    getProviders()
      .then((providers) => {
        if (cancelled || !Array.isArray(providers)) return
        const currentProvider = providers.find((item) => item.id === providerId)
        if (!currentProvider) return
        const currentSpecialties = toServiceKeys(currentProvider.specialties)
        setProviderProfile((profile) => ({ ...profile, ...currentProvider, specialties: currentSpecialties.length > 0 ? currentSpecialties : profile.specialties }))
        setRegistrationForm((form) => ({
          name: currentProvider.name || form.name,
          phone: currentProvider.phone || form.phone,
          telegram: currentProvider.telegram || form.telegram,
          vehicle: currentProvider.vehicle || form.vehicle,
          plate: currentProvider.plate || form.plate,
          specialties: currentSpecialties.length > 0 ? currentSpecialties : form.specialties,
          serviceRadiusKm: currentProvider.serviceRadiusKm ?? form.serviceRadiusKm,
          identityDocumentRef: form.identityDocumentRef,
          driverLicenseRef: form.driverLicenseRef,
          vehicleRegistrationRef: form.vehicleRegistrationRef,
          serviceProofRef: form.serviceProofRef,
          selfieRef: form.selfieRef,
        }))
        setOnDuty(currentProvider.status === "online" || currentProvider.status === "busy")
        if (currentProvider.location) setProviderLocation(currentProvider.location)
        if (!currentProvider.registeredAt) setStep("register")
      })
      .catch(() => {
        // Demo mode stays usable even when the backend is temporarily unavailable.
      })

    return () => {
      cancelled = true
    }
  }, [providerId])

  useEffect(() => {
    if (!onDuty || typeof navigator === "undefined" || !("geolocation" in navigator)) return

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setProviderLocation({ lat: position.coords.latitude, lng: position.coords.longitude })
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 8000 },
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [onDuty])

  useEffect(() => {
    if (!onDuty || !providerAuthToken) return

    const heartbeat = () => {
      updateProviderPresence(providerId, {
        status: "online",
        location: providerLocation,
        etaMinutes: providerProfile.etaMinutes ?? provider.etaMinutes,
      }, providerAuthToken).catch(() => undefined)
    }

    heartbeat()
    const interval = window.setInterval(heartbeat, 12000)
    return () => window.clearInterval(interval)
  }, [onDuty, providerAuthToken, providerId, providerLocation, providerProfile.etaMinutes])

  useEffect(() => {
    const interval = window.setInterval(() => setOfferClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!onDuty || !providerAuthToken || activeOrder || step !== "duty") return
    let cancelled = false

    const refreshOffers = () => {
      getProviderOffers(providerId, providerAuthToken)
        .then((offers) => {
          if (!cancelled) {
            setIncomingOffers(Array.isArray(offers) ? offers : [])
            if (offers.length > 0) setOfferError(undefined)
          }
        })
        .catch(() => {
          if (!cancelled) setIncomingOffers([])
        })
    }

    refreshOffers()
    const interval = window.setInterval(refreshOffers, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeOrder, onDuty, providerAuthToken, providerId, step])

  const activeOffer = incomingOffers[0]
  const secondsLeft = activeOffer?.expiresAt ? Math.max(0, Math.ceil((parseApiDateMs(activeOffer.expiresAt) - offerClock) / 1000)) : 0

  const acceptOffer = async (offer: DispatchOffer) => {
    setOfferSaving(true)
    setOfferError(undefined)
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      const result = await acceptProviderOffer(providerId, offer.id, providerAuthToken)
      setActiveOrder(result.order)
      setProviderProfile((profile) => ({ ...profile, status: "busy", assignedOrderId: result.order.id } as ProviderAvailability))
      setIncomingOffers([])
      setOnDuty(true)
      setStep("navigation")
      setProgress(18)
    } catch (error) {
      const detail = (error as { detail?: { code?: string; message?: string } }).detail
      setOfferError(detail?.code === "OFFER_EXPIRED" ? "Пропозиція вже завершилась." : "Замовлення вже прийняв інший виконавець.")
      setIncomingOffers((offers) => offers.filter((item) => item.id !== offer.id))
    } finally {
      setOfferSaving(false)
    }
  }

  const declineOffer = async (offer: DispatchOffer) => {
    setOfferSaving(true)
    setOfferError(undefined)
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      await declineProviderOffer(providerId, offer.id, providerAuthToken)
      setIncomingOffers((offers) => offers.filter((item) => item.id !== offer.id))
    } catch {
      setOfferError("Не вдалося пропустити заявку.")
    } finally {
      setOfferSaving(false)
    }
  }

  const advanceProviderOrder = async (nextStatus: OrderStatus) => {
    if (!activeOrder?.id) return
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      const order = await updateProviderOrderStatus(providerId, activeOrder.id, nextStatus, providerAuthToken)
      const normalizedStatus = normalizeOrderStatus(order.status)
      setActiveOrder(order)
      if (normalizedStatus === "completed" || normalizedStatus === "cancelled") {
        setProviderProfile((profile) => ({ ...profile, status: "online", assignedOrderId: undefined } as ProviderAvailability))
        setStep("completed")
      } else if (normalizedStatus === "arrived" || normalizedStatus === "in_progress") {
        setStep("arrived")
      } else {
        setStep("navigation")
      }
    } catch {
      setOfferError("Не вдалося оновити статус замовлення.")
    }
  }

  const updateRegistrationForm = (patch: Partial<PartnerRegistrationForm>) => {
    setRegistrationForm((form) => ({ ...form, ...patch }))
  }

  const toggleRegistrationSpecialty = (specialty: ServiceKey) => {
    setRegistrationForm((form) => ({
      ...form,
      specialties: form.specialties.includes(specialty)
        ? form.specialties.filter((item) => item !== specialty)
        : [...form.specialties, specialty],
    }))
  }

  const saveRegistration = async () => {
    if (!registrationForm.name.trim() || !registrationForm.phone.trim() || !registrationForm.vehicle.trim() || registrationForm.specialties.length === 0) {
      setRegistrationError("Заповніть профіль і оберіть хоча б одну послугу.")
      return
    }

    setRegistrationSaving(true)
    setRegistrationError(undefined)
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      const updated = await updateProviderProfile(providerId, {
        ...registrationForm,
        location: providerLocation,
      }, providerAuthToken)
      const documentsReady = Boolean(registrationForm.identityDocumentRef.trim() && registrationForm.driverLicenseRef.trim() && registrationForm.vehicleRegistrationRef.trim() && registrationForm.serviceProofRef.trim() && registrationForm.selfieRef.trim())
      const trustedProfile = documentsReady
        ? await submitProviderVerification(providerId, {
          identityDocumentRef: registrationForm.identityDocumentRef,
          driverLicenseRef: registrationForm.driverLicenseRef,
          vehicleRegistrationRef: registrationForm.vehicleRegistrationRef,
          serviceProofRef: registrationForm.serviceProofRef,
          selfieRef: registrationForm.selfieRef,
        }, providerAuthToken)
        : updated
      setProviderProfile((profile) => ({ ...profile, ...trustedProfile, specialties: toServiceKeys(trustedProfile.specialties) }))
      if (typeof window !== "undefined") window.localStorage.setItem(`pomichPartnerRegistered:${providerId}`, "1")
      setStep("duty")
    } catch {
      setRegistrationError("Не вдалося зберегти профіль партнера.")
    } finally {
      setRegistrationSaving(false)
    }
  }

  const setDuty = async (nextDuty: boolean) => {
    if (nextDuty && !providerCanGoOnline) {
      setOfferError("Після перевірки профілю диспетчер відкриє доступ до заявок.")
      return
    }
    setPresenceSaving(true)
    setOnDuty(nextDuty)
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      await updateProviderPresence(providerId, {
        status: nextDuty ? "online" : "offline",
        location: providerLocation,
        etaMinutes: providerProfile.etaMinutes ?? provider.etaMinutes,
      }, providerAuthToken)
    } catch {
      // The local UI still changes so the duty scenario remains usable in demo mode.
    } finally {
      setPresenceSaving(false)
    }
  }

  const submitProviderAccountLogin = async () => {
    setAuthSaving(true)
    setAuthError(undefined)
    try {
      const session = await createProviderAccountSession(providerId, accountLogin, accountPassword)
      storeAuthSession(providerSessionStorageKey, session)
      setProviderAccessToken(session.accessToken)
      setAccountPassword("")
    } catch {
      setAuthError("Не вдалося увійти в акаунт партнера.")
    } finally {
      setAuthSaving(false)
    }
  }

  useEffect(() => {
    if (step !== "navigation") return
    const interval = window.setInterval(() => setProgress((value) => Math.min(100, value + 9)), 1200)
    return () => window.clearInterval(interval)
  }, [step])

  useEffect(() => {
    if (!activeOrder && step === "navigation" && progress >= 100) setStep("arrived")
  }, [activeOrder, progress, step])

  if (!providerAuthToken && !providerToken) {
    return (
      <AccountLoginStep
        title="Вхід партнера"
        subtitle="Увійдіть у свій акаунт POMICH, щоб бачити заявки та оновлювати статуси."
        login={accountLogin}
        password={accountPassword}
        saving={authSaving}
        error={authError}
        onLoginChange={setAccountLogin}
        onPasswordChange={setAccountPassword}
        onSubmit={submitProviderAccountLogin}
      />
    )
  }

  if (step === "register") {
    return (
      <ProviderRegistrationStep
        form={registrationForm}
        saving={registrationSaving}
        error={authError ?? registrationError}
        onChange={updateRegistrationForm}
        onToggleSpecialty={toggleRegistrationSpecialty}
        onSubmit={saveRegistration}
      />
    )
  }

  if (step === "duty") {
    if (activeOffer) {
      return (
        <IncomingOfferStep
          offer={activeOffer}
          secondsLeft={secondsLeft}
          saving={offerSaving}
          error={offerError}
          onAccept={() => acceptOffer(activeOffer)}
          onDecline={() => declineOffer(activeOffer)}
        />
      )
    }

    return (
      <ScreenLayout footer={onDuty ? <div style={{ display: "grid", gap: 10 }}><PrimaryButton label="Дивитися заявки поруч" onClick={() => setStep("offer")} disabled={!providerAuthToken} /><SecondaryButton label="Піти з лінії" onClick={() => setDuty(false)} disabled={!providerAuthToken} /><SecondaryButton label="Редагувати профіль" onClick={() => setStep("register")} /></div> : <div style={{ display: "grid", gap: 10 }}><PrimaryButton label={!providerCanGoOnline ? "Очікує перевірки" : presenceSaving ? "Оновлюємо статус…" : "Вийти на лінію"} onClick={() => setDuty(true)} disabled={!providerAuthToken || !providerCanGoOnline || presenceSaving} /><SecondaryButton label="Редагувати профіль" onClick={() => setStep("register")} /></div>}>
        <Header title="Партнер POMICH" subtitle={onDuty ? "Ви на лінії та бачите заявки поруч" : "Почніть зміну, щоб клієнти бачили вас на карті"} />
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
          {authError ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{authError}</div> : null}
          <RouteMap pickup={providerLocation} providers={[providerPresence]} subtitle={onDuty ? "Ваша позиція активна" : "Ваша позиція прихована для клієнтів"} />
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ color: "#6B7280", fontWeight: 800, fontSize: 12 }}>Статус зміни</div>
                <div style={{ color: DARK, fontWeight: 950, fontSize: 22, marginTop: 4 }}>{onDuty ? "На лінії" : "Поза лінією"}</div>
              </div>
              <div style={{ width: 54, height: 34, borderRadius: 999, padding: 4, background: onDuty ? "#DCFCE7" : "#E5E7EB", display: "flex", justifyContent: onDuty ? "flex-end" : "flex-start", alignItems: "center" }}>
                <div style={{ width: 26, height: 26, borderRadius: 999, background: onDuty ? BRAND : "#9CA3AF" }} />
              </div>
            </div>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: BG, borderRadius: 14, padding: 12 }}>
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800 }}>Зона</div>
                <div style={{ color: DARK, fontWeight: 950, marginTop: 4 }}>Ужгород · 7 км</div>
              </div>
              <div style={{ background: BG, borderRadius: 14, padding: 12 }}>
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800 }}>ETA клієнту</div>
                <div style={{ color: DARK, fontWeight: 950, marginTop: 4 }}>~{provider.etaMinutes} хв</div>
              </div>
            </div>
            <div style={{ color: "#6B7280", fontWeight: 700, fontSize: 13, marginTop: 12 }}>
              {onDuty ? "Клієнти бачать вашу картку, рейтинг, приблизний час прибуття та можуть отримати вас після створення заявки." : "Поки ви поза лінією, клієнт бачить менше доступних механіків поруч."}
            </div>
          </div>
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 950, color: DARK }}>Верифікація</div>
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>Доступ до заявок тільки після перевірки</div>
              </div>
              <VerificationPill status={providerProfile.verificationStatus} />
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                ["ID", providerProfile.verification?.identityDocument],
                ["Права", providerProfile.verification?.driverLicense],
                ["Авто", providerProfile.verification?.vehicleRegistration],
                ["Сервіс", providerProfile.verification?.serviceProof],
              ].map(([label, done]) => (
                <div key={String(label)} style={{ borderRadius: 12, background: done ? "#E8F8F1" : BG, color: done ? BRAND : "#6B7280", padding: "9px 10px", fontSize: 12, fontWeight: 950 }}>
                  {done ? "✓" : "•"} {label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 950, color: DARK }}>Профіль допомоги</div>
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>{providerPresence.vehicle} · радіус {providerPresence.serviceRadiusKm ?? 7} км</div>
              </div>
              <button onClick={() => setStep("register")} style={{ border: `1px solid ${BORDER}`, background: BG, color: DARK, borderRadius: 999, padding: "8px 10px", fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>Змінити</button>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(providerPresence.specialties ?? []).map((specialty) => (
                <span key={specialty} style={{ borderRadius: 999, padding: "7px 10px", background: "#E8F8F1", color: BRAND, fontSize: 12, fontWeight: 900 }}>{getProviderCapabilityLabel(specialty)}</span>
              ))}
            </div>
          </div>
          {offerError ? <div style={{ background: "#FFF7ED", color: "#B45309", borderRadius: 14, padding: 12, fontWeight: 850 }}>{offerError}</div> : null}
        </div>
      </ScreenLayout>
    )
  }

  if (step === "completed") {
    return (
      <ScreenLayout footer={<PrimaryButton label="Повернутись до чергування" onClick={() => { setStep("duty"); setProgress(18) }} />}>
        <div style={{ minHeight: "100%", display: "flex", justifyContent: "center", flexDirection: "column", textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 54 }}>✅</div>
          <div style={{ fontWeight: 950, fontSize: 24, color: DARK, marginTop: 10 }}>Замовлення завершено</div>
          <div style={{ color: "#6B7280", fontWeight: 800, marginTop: 8 }}>Ваш дохід: {provider.earnings.toLocaleString("uk-UA")} ₴</div>
        </div>
      </ScreenLayout>
    )
  }

  if (step === "arrived") {
    const activeStatus = normalizeOrderStatus(activeOrder?.status)
    const nextStatus: OrderStatus = activeStatus === "arrived" ? "in_progress" : "completed"
    return (
      <ScreenLayout footer={<PrimaryButton label={activeStatus === "arrived" ? "ПОЧАТИ РОБОТУ" : "ЗАВЕРШИТИ"} onClick={() => activeOrder ? advanceProviderOrder(nextStatus) : setStep("completed")} />}>
        <Header title={activeStatus === "in_progress" ? "Допомога триває" : "Ви на місці"} subtitle="Клієнт бачить ваш статус у POMICH" status={activeStatus === "in_progress" ? "in_progress" : "arrived"} />
        <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
          <ProviderCard orderId={activeOrder?.id} assignedProvider={activeOrder?.assignedProvider ?? providerPresence} />
          <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14 }}>
            <Timeline status={activeStatus === "in_progress" ? "in_progress" : "arrived"} />
            <div style={{ fontWeight: 900, color: DARK, marginTop: 16 }}>Поточна дія</div>
            <div style={{ color: "#6B7280", fontWeight: 700, marginTop: 6 }}>Підтвердіть завершення, коли допомогу надано.</div>
          </div>
        </div>
      </ScreenLayout>
    )
  }

  if (step === "navigation") {
    const providerPosition = interpolate(PROVIDER_START, pickup, progress)
    const activeStatus = normalizeOrderStatus(activeOrder?.status)
    const nextStatus: OrderStatus = activeStatus === "assigned" ? "en_route" : "arrived"
    return (
      <ScreenLayout footer={<PrimaryButton label={activeStatus === "assigned" ? "ЇДУ ДО КЛІЄНТА" : "Я НА МІСЦІ"} onClick={() => activeOrder ? advanceProviderOrder(nextStatus) : setStep("arrived")} />}>
        <Header title="Маршрут до клієнта" subtitle={activeOrder?.id ? `Активне замовлення #${activeOrder.id}` : "Активне замовлення #PM-DEMO"} status={activeStatus === "assigned" ? "assigned" : "en_route"} />
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
          <RouteMap pickup={pickup} destination={destination} providerPosition={providerPosition} subtitle={`${Math.round(progress)}% маршруту`} />
          <div style={{ background: "#111827", color: "#fff", borderRadius: 18, padding: 16 }}>
            <div style={{ fontWeight: 950, fontSize: 20 }}>ETA {Math.max(1, Math.ceil((100 - progress) / 12))} хв</div>
            <div style={{ color: "#CBD5E1", marginTop: 6, fontWeight: 700 }}>Клієнт: вул. Собранецька, Ужгород</div>
            <div style={{ height: 9, background: "#1F2937", borderRadius: 999, marginTop: 14 }}>
              <div style={{ width: `${Math.max(8, progress)}%`, height: "100%", borderRadius: 999, background: BRAND }} />
            </div>
          </div>
        </div>
      </ScreenLayout>
    )
  }

  return (
    <ScreenLayout footer={<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><PrimaryButton label="Прийняти" onClick={() => setStep("navigation")} /><SecondaryButton label="Пропустити" /></div>}>
      <Header title="Нова заявка поруч" subtitle="4.8 км · евакуація · оплата готівкою" onBack={() => setStep("duty")} status="searching" />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <RouteMap pickup={pickup} destination={destination} subtitle="Маршрут клієнта" />
        <div style={{ background: "#fff", borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 950, color: DARK }}>🚛 Евакуатор</div>
              <div style={{ color: "#6B7280", fontWeight: 700, marginTop: 4 }}>Volvo V60 · авто заводиться</div>
            </div>
            <div style={{ textAlign: "right", fontWeight: 950, color: BRAND }}>{provider.earnings.toLocaleString("uk-UA")} ₴</div>
          </div>
          <div style={{ marginTop: 14, background: BG, borderRadius: 14, padding: 12, color: DARK, fontWeight: 800 }}>Після прийняття клієнт отримає вашу картку, телефон, чат і live tracking.</div>
        </div>
      </div>
    </ScreenLayout>
  )
}

function normalizeOrderStatus(status?: string): OrderStatus {
  if (status === "searching" || status === "assigned" || status === "en_route" || status === "arrived" || status === "in_progress" || status === "completed" || status === "cancelled" || status === "draft") {
    return status
  }
  if (status === "created" || status === "matching") return "searching"
  if (status === "tracking") return "en_route"
  return "draft"
}

function screenForOrderStatus(status: OrderStatus): Screen {
  if (status === "searching") return "searching"
  if (status === "assigned") return "assigned"
  if (status === "en_route") return "tracking"
  if (status === "arrived") return "arrived"
  if (status === "in_progress") return "in_progress"
  if (status === "completed") return "completed"
  if (status === "cancelled") return "cancelled"
  return "home"
}

function nextOrderStatuses(status: OrderStatus): OrderStatus[] {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    draft: ["searching", "cancelled"],
    searching: ["assigned", "cancelled"],
    assigned: ["en_route", "cancelled"],
    en_route: ["arrived", "cancelled"],
    arrived: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
  }
  return transitions[status] ?? []
}

function AdminFlow({ adminToken }: { adminToken?: string }) {
  const adminSessionStorageKey = useMemo(() => authSessionStorageKey("admin", "admin"), [])
  const [adminAccessToken, setAdminAccessToken] = useState<string | undefined>(() => {
    if (isAuthSessionToken(adminToken)) return adminToken
    return readStoredAuthSession(authSessionStorageKey("admin", "admin"), "admin", "admin")
  })
  const adminAuthToken = adminAccessToken
  const [orders, setOrders] = useState<OrderResponse[]>([])
  const [providers, setProviders] = useState<ProviderAvailability[]>([])
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | "all">("all")
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [authError, setAuthError] = useState<string | undefined>()
  const [accountLogin, setAccountLogin] = useState("dispatcher")
  const [accountPassword, setAccountPassword] = useState("")
  const [authSaving, setAuthSaving] = useState(false)

  useEffect(() => {
    if (adminAuthToken) return

    if (!adminToken) {
      setAuthError(undefined)
      return
    }

    if (isAuthSessionToken(adminToken)) {
      if (typeof window !== "undefined") window.sessionStorage.setItem(adminSessionStorageKey, adminToken)
      setAdminAccessToken(adminToken)
      setAuthError(undefined)
      return
    }

    let cancelled = false
    createAdminSession(adminToken)
      .then((session) => {
        if (cancelled) return
        storeAuthSession(adminSessionStorageKey, session)
        setAdminAccessToken(session.accessToken)
        setAuthError(undefined)
      })
      .catch(() => {
        if (!cancelled) setAuthError("Не вдалося відкрити захищену адмін-сесію.")
      })

    return () => {
      cancelled = true
    }
  }, [adminAuthToken, adminSessionStorageKey, adminToken])

  const submitAdminAccountLogin = async () => {
    setAuthSaving(true)
    setAuthError(undefined)
    try {
      const session = await createAdminAccountSession(accountLogin, accountPassword)
      storeAuthSession(adminSessionStorageKey, session)
      setAdminAccessToken(session.accessToken)
      setAccountPassword("")
    } catch {
      setAuthError("Не вдалося увійти в адмін-акаунт.")
    } finally {
      setAuthSaving(false)
    }
  }

  const refresh = () => {
    setLoading(true)
    if (!adminAuthToken) {
      setOrders([])
      setError(authError ?? "Очікуємо захищену адмін-сесію.")
      setLoading(false)
    } else {
      getOrders(adminAuthToken)
        .then((items) => {
          setOrders(items.slice().reverse())
          setError(undefined)
        })
        .catch(() => setError("Не вдалося завантажити заявки."))
        .finally(() => setLoading(false))
    }

    getProviders()
      .then((items) => setProviders(Array.isArray(items) ? items : []))
      .catch(() => setProviders([]))
  }

  useEffect(() => {
    refresh()
    const interval = window.setInterval(refresh, 10000)
    return () => window.clearInterval(interval)
  }, [adminAuthToken, authError])

  if (!adminAuthToken && !adminToken) {
    return (
      <AccountLoginStep
        title="Вхід диспетчера"
        subtitle="Увійдіть в адмін-акаунт, щоб керувати заявками та перевірками."
        login={accountLogin}
        password={accountPassword}
        saving={authSaving}
        error={authError}
        onLoginChange={setAccountLogin}
        onPasswordChange={setAccountPassword}
        onSubmit={submitAdminAccountLogin}
      />
    )
  }

  const filteredOrders = orders.filter((order) => selectedStatus === "all" || normalizeOrderStatus(order.status) === selectedStatus)
  const selectedOrder = filteredOrders.find((order) => order.id === selectedOrderId) ?? filteredOrders[0]
  const activeCount = orders.filter((order) => !["completed", "cancelled"].includes(normalizeOrderStatus(order.status))).length
  const searchingCount = orders.filter((order) => normalizeOrderStatus(order.status) === "searching").length
  const enRouteCount = orders.filter((order) => normalizeOrderStatus(order.status) === "en_route").length
  const completedCount = orders.filter((order) => normalizeOrderStatus(order.status) === "completed").length
  const onlineProviderCount = providers.filter((item) => item.status === "online").length
  const busyProviderCount = providers.filter((item) => item.status === "busy").length
  const verifiedProviderCount = providers.filter((item) => isVerified(item.verificationStatus)).length
  const pendingProviderCount = providers.filter((item) => item.verificationStatus === "pending").length

  const setOrderStatus = async (order: OrderResponse, status: OrderStatus) => {
    if (!order.id) return
    try {
      if (!adminAuthToken) throw new Error("admin_session_missing")
      const updated = await updateOrderStatus(order.id, status, adminAuthToken)
      setOrders((items) => items.map((item) => item.id === order.id ? { ...item, ...updated } : item))
      setError(undefined)
    } catch {
      setError("Недопустимий перехід статусу або немає доступу адміністратора.")
    }
  }

  const setProviderVerification = async (item: ProviderAvailability, status: "verified" | "rejected") => {
    try {
      if (!adminAuthToken) throw new Error("admin_session_missing")
      const updated = await reviewProviderVerification(item.id, { status }, adminAuthToken)
      setProviders((items) => items.map((providerItem) => providerItem.id === item.id ? { ...providerItem, ...updated } : providerItem))
      setError(undefined)
    } catch {
      setError("Не вдалося оновити перевірку партнера.")
    }
  }

  const statusFilters: Array<{ key: OrderStatus | "all"; label: string }> = [
    { key: "all", label: "Усі" },
    { key: "searching", label: "Пошук" },
    { key: "assigned", label: "Назначено" },
    { key: "en_route", label: "У дорозі" },
    { key: "arrived", label: "На місці" },
    { key: "in_progress", label: "Робота" },
  ]
  const selectedOffers = selectedOrder?.offers ?? []
  const selectedOfferSummary = selectedOffers.length === 0
    ? "немає"
    : selectedOffers.map((offer) => {
      const distance = typeof offer.distanceKm === "number" ? ` · ${offer.distanceKm.toFixed(1)} км` : ""
      return `${offer.providerId}: ${offer.status}${distance}`
    }).join(" / ")
  const selectedDispatchState = selectedOrder?.dispatchState ?? (selectedOffers.length > 0 ? "OFFERS_SENT" : "—")

  return (
    <ScreenLayout>
      <Header title="Адмін панель" subtitle="Диспетчеризація, статуси та контроль заявок" />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            ["Активні", activeCount],
            ["Очікують", searchingCount],
            ["У дорозі", enRouteCount],
            ["Завершені", completedCount],
            ["На лінії", onlineProviderCount],
            ["У роботі", busyProviderCount],
            ["Verified", verifiedProviderCount],
            ["Review", pendingProviderCount],
          ].map(([label, value]) => (
            <div key={label} style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 16, padding: 13 }}>
              <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800 }}>{label}</div>
              <div style={{ color: DARK, fontSize: 24, fontWeight: 950, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 950, color: DARK }}>Парк партнерів</div>
              <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>{onlineProviderCount} на лінії · {providers.length} у системі</div>
            </div>
            <div style={{ color: onlineProviderCount > 0 ? BRAND : "#B45309", background: onlineProviderCount > 0 ? "#E8F8F1" : "#FFF7ED", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 950 }}>
              {onlineProviderCount > 0 ? "Покриття є" : "Немає покриття"}
            </div>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {providers.slice(0, 4).map((item) => (
              <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", background: BG, borderRadius: 14, padding: "10px 12px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, color: DARK, fontSize: 13 }}>{item.name}</div>
                  <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 700, marginTop: 2 }}>{item.vehicle ?? "Автодопомога"} · ETA ~{item.etaMinutes ?? 15} хв</div>
                  <div style={{ color: "#6B7280", fontSize: 11, fontWeight: 800, marginTop: 3 }}>{toServiceKeys(item.specialties).map(getProviderCapabilityLabel).join(" · ") || "Послуги не вказані"}</div>
                  <div style={{ marginTop: 7 }}><VerificationPill status={item.verificationStatus} /></div>
                </div>
                <div style={{ display: "grid", gap: 7, justifyItems: "end" }}>
                  <div style={{ color: item.status === "offline" ? "#6B7280" : BRAND, fontWeight: 950, fontSize: 12, whiteSpace: "nowrap" }}>{providerStatusLabel(item.status)}</div>
                  {item.verificationStatus === "pending" ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setProviderVerification(item, "verified")} style={{ border: "none", background: BRAND, color: "#fff", borderRadius: 999, padding: "7px 9px", fontSize: 11, fontWeight: 950, cursor: "pointer", fontFamily: "inherit" }}>OK</button>
                      <button onClick={() => setProviderVerification(item, "rejected")} style={{ border: `1px solid #FECDD3`, background: "#FFF1F2", color: "#BE123C", borderRadius: 999, padding: "7px 9px", fontSize: 11, fontWeight: 950, cursor: "pointer", fontFamily: "inherit" }}>Ні</button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {statusFilters.map((filter) => {
            const active = selectedStatus === filter.key
            return (
              <button key={filter.key} onClick={() => setSelectedStatus(filter.key)} style={{ flex: "0 0 auto", border: active ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: active ? "#E8F8F1" : "#fff", color: active ? BRAND : DARK, borderRadius: 999, padding: "8px 11px", fontSize: 12, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>
                {filter.label}
              </button>
            )
          })}
        </div>

        {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{error}</div> : null}

        <div style={{ display: "grid", gap: 10 }}>
          {loading ? <div style={{ color: "#6B7280", fontWeight: 800, padding: 12 }}>Завантажуємо заявки…</div> : null}
          {!loading && filteredOrders.length === 0 ? <div style={{ color: "#6B7280", fontWeight: 800, padding: 12 }}>Немає заявок у цьому фільтрі.</div> : null}
          {filteredOrders.slice(0, 8).map((order) => {
            const status = normalizeOrderStatus(order.status)
            const active = selectedOrder?.id === order.id
            return (
              <button key={order.id} onClick={() => setSelectedOrderId(order.id)} style={{ width: "100%", border: active ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: "#fff", borderRadius: 16, padding: 13, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 950, color: DARK }}>{order.id ?? "Без номера"}</div>
                    <div style={{ marginTop: 4, color: "#6B7280", fontSize: 12, fontWeight: 800 }}>{getServiceEmoji(order.service)} {getServiceLabel(order.service)} · {order.source ?? "web"}</div>
                  </div>
                  <StatusPill status={status} />
                </div>
                <div style={{ marginTop: 8, color: "#374151", fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>
                  {order.customerLocation ?? "Локація не вказана"} → {order.destination ?? "Призначення не вказано"}
                </div>
              </button>
            )
          })}
        </div>

        {selectedOrder ? (
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 15, boxShadow: "0 8px 24px rgba(0,0,0,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 950, color: DARK }}>Картка заявки</div>
                <div style={{ marginTop: 3, color: "#6B7280", fontSize: 12, fontWeight: 800 }}>{selectedOrder.id}</div>
              </div>
              <StatusPill status={normalizeOrderStatus(selectedOrder.status)} />
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 8, fontSize: 13 }}>
              <div><strong>Послуга:</strong> {getServiceLabel(selectedOrder.service)}</div>
              <div><strong>Авто:</strong> {selectedOrder.vehicleState ?? "Не вказано"}</div>
              <div><strong>Клієнт:</strong> {selectedOrder.telegramUsername ? `@${selectedOrder.telegramUsername}` : selectedOrder.chatId ?? "web"}</div>
              <div><strong>Маршрут:</strong> {selectedOrder.customerLocation ?? "?"} → {selectedOrder.destination ?? "?"}</div>
              <div><strong>Створено:</strong> {selectedOrder.createdAt ?? "—"}</div>
              <div><strong>Dispatch:</strong> {selectedDispatchState}</div>
              <div><strong>Оффери:</strong> {selectedOfferSummary}</div>
              {selectedOrder.assignedProvider ? <div><strong>Виконавець:</strong> {selectedOrder.assignedProvider.name ?? selectedOrder.assignedProviderId} · {selectedOrder.assignedProvider.vehicle ?? "автодопомога"}</div> : null}
            </div>
            <div style={{ marginTop: 13 }}>
              <Timeline status={normalizeOrderStatus(selectedOrder.status)} />
            </div>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
              {nextOrderStatuses(normalizeOrderStatus(selectedOrder.status)).filter((nextStatus) => nextStatus !== "cancelled").map((nextStatus) => (
                <SecondaryButton key={nextStatus} label={orderStatusLabels[nextStatus]} onClick={() => setOrderStatus(selectedOrder, nextStatus)} />
              ))}
            </div>
            {nextOrderStatuses(normalizeOrderStatus(selectedOrder.status)).includes("cancelled") ? (
              <div style={{ marginTop: 9 }}>
                <SecondaryButton label="Скасувати заявку" danger onClick={() => setOrderStatus(selectedOrder, "cancelled")} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </ScreenLayout>
  )
}

export default function CustomerApp() {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const isMobile = useMediaQuery("(max-width: 640px)")
  const adminToken = useMemo(() => getStoredQueryToken("adminToken", "pomichAdminToken"), [])
  const providerToken = useMemo(() => getStoredQueryToken("providerToken", "pomichProviderToken"), [])
  const initialRole = useMemo<Role | null>(() => {
    if (typeof window === "undefined") return null
    const queryRole = new URLSearchParams(window.location.search).get("role")
    if (queryRole === "customer" || queryRole === "provider") return queryRole
    if (queryRole === "admin") return "admin"
    return null
  }, [])
  const [role, setRole] = useState<Role | null>(initialRole)
  const compact = telegramContext.isTelegram || isMobile

  const handleRoleChange = (nextRole: Role | null) => {
    setRole(nextRole)

    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (nextRole) {
      url.searchParams.set("role", nextRole)
    } else {
      url.searchParams.delete("role")
    }
    url.hash = ""
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }

  useEffect(() => {
    if (initialRole === null) setRole(null)
  }, [initialRole])

  useEffect(() => {
    if (typeof window === "undefined") return
    const syncRoleFromUrl = () => {
      const queryRole = new URLSearchParams(window.location.search).get("role")
      if (queryRole === "customer" || queryRole === "provider") {
        setRole(queryRole)
        return
      }
      if (queryRole === "admin") {
        setRole("admin")
        return
      }
      setRole(null)
    }

    window.addEventListener("popstate", syncRoleFromUrl)
    return () => window.removeEventListener("popstate", syncRoleFromUrl)
  }, [])

  return (
    role === null ? (
      <LandingPage onSelect={handleRoleChange} />
    ) : (
      <AppShell compact={compact} role={role} onRoleChange={handleRoleChange}>
        {role === "provider" ? <ProviderFlow providerToken={providerToken} /> : role === "admin" ? <AdminFlow adminToken={adminToken} /> : <CustomerFlow />}
      </AppShell>
    )
  )
}
