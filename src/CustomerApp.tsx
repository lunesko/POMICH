import { useCallback, useEffect, useMemo, useState } from "react"

import { acceptProviderOffer, cancelOrder as cancelOrderRequest, createGuestCustomerSession, createOrder, createProviderAccountSession, createProviderSession, createSelfProviderSession, createTelegramCustomerSession, declineProviderOffer, getMapProviders, getNearbyMapOrders, getOrder, getProviderOffers, getProviders, getTelegramSession, getUserAccount, retryDispatch, setUserPreferredRole, submitProviderVerification, updateCustomerProfile, updateProviderOrderStatus, updateProviderPresence, updateProviderProfile, type AuthSession, type CustomerProfile, type DispatchOffer, type MapRequestPin, type OrderResponse, type ProviderAvailability, type UserAccountStatus, type VerificationStatus } from "./api/client"
import RouteMap from "./components/map/RouteMap"
import {
  calculateDistanceKm,
  calculatePrice,
  sanitizeLocation,
  validateCustomerOrderInput,
  type CustomerOrderInput,
  type ServiceKey,
} from "./lib/pomichDomain"
import { getTelegramContext, resolveEntryRole } from "./telegram"
import { getProfileChecklist, customerProfileStatusLabel, customerProfileStatusTone, isCustomerProfileComplete, isCustomerReadyForOrder, isCustomerVerified, profileChecklistSummary } from "./lib/customerProfile"
import { formatLocalPhoneDisplay, nationalDigitsFromPhone, validateUkraineMobilePhone } from "./lib/ukrainePhone"
import { PhoneInput } from "./components/ui/PhoneInput"
import { OtpVerificationPanel } from "./components/ui/OtpVerificationPanel"
import { storeLinkedProviderId, resolveProviderIdForCustomer } from "./lib/userAccount"
import { mediaQueries } from "./lib/breakpoints"
import { useMediaQuery } from "./hooks/useMediaQuery"
import { useTelegramMainButton, useTelegramBackButton, useTelegramUx } from "./hooks/useTelegramUx"
import OnboardingGate from "./components/onboarding/OnboardingGate"
import ClientCabinet from "./components/cabinet/ClientCabinet"
import ProviderCabinet from "./components/cabinet/ProviderCabinet"
import AdminFlow from "./components/admin/AdminFlow"
import FormContainer, { FormFooterBar, FormHeader } from "./components/layout/FormContainer"
import { ServiceRadiusField } from "./components/ui/ServiceRadiusField"
import { ThemeToggle } from "./components/ui/ThemeToggle"
import { usePomichTheme } from "./context/PomichThemeProvider"
import { type PomichThemeColors, type PomichThemeMode } from "./lib/theme"
import { clearHiddenAdminHash, isHiddenAdminHash } from "./lib/adminAccess"

type Role = "customer" | "provider" | "admin"
type Screen =
  | "profile"
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
  city: string
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
const DEFAULT_SERVICE_RADIUS_KM = 15
const PICKUP: Point = { lat: 48.6208, lng: 22.2879 }
const DEFAULT_DESTINATION: Point = { lat: 48.6175, lng: 22.3056 }
const PROVIDER_START: Point = { lat: 48.632, lng: 22.271 }

const services = [
  { key: "tow", emoji: "🚛", label: "Евакуатор", tone: "#E8F8F1" },
  { key: "battery", emoji: "🔋", label: "Акумулятор", tone: "#EFF6FF" },
  { key: "wheel", emoji: "🛞", label: "Колесо", tone: "#FFF7ED" },
  { key: "fuel", emoji: "⛽", label: "Пальне", tone: "#F5F3FF" },
  { key: "lockout", emoji: "🔑", label: "Замок", tone: "#FCE7F3" },
  { key: "mechanic", emoji: "🔧", label: "Інше", tone: "#ECFCCB" },
] as const

const providerCapabilityLabels: Record<ServiceKey, string> = {
  tow: "Евакуатор",
  battery: "Акумулятор",
  wheel: "Шиномонтаж",
  fuel: "Пальне",
  lockout: "Відкрити авто",
  mechanic: "СТО",
}

const partnerRegistrationServices = services.filter((service) =>
  (["tow", "wheel", "battery", "fuel", "mechanic"] as ServiceKey[]).includes(service.key),
)

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
  const fromQuery = new URLSearchParams(window.location.search).get("providerId")
  if (fromQuery) return fromQuery
  const linked = window.sessionStorage.getItem("pomichLinkedProviderId")
  if (linked) return linked
  const customerId = window.sessionStorage.getItem("pomichCustomerId")
  if (customerId) {
    const derived = resolveProviderIdForCustomer(customerId)
    if (derived) return derived
  }
  return provider.id
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

function providerEtaMinutes(pickup: Point, providers: ProviderAvailability[], fallback: number): number {
  const nearest = nearbyProvidersFor(pickup, providers)[0]
  if (!nearest) return fallback
  return nearest.etaMinutes ?? Math.max(8, Math.ceil(distanceToProvider(pickup, nearest) * 4))
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

function interpolate(from: Point, to: Point, progress: number): Point {
  const ratio = Math.max(0, Math.min(100, progress)) / 100
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
  }
}

const FLOW_STEP_LABELS = ["Оберіть проблему", "Підтвердьте місце", "ETA і ціну", "Стежте за допомогою"] as const

function StepBadge({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "7px 11px", background: "#E8F8F1", color: BRAND, fontSize: 12, fontWeight: 950, marginBottom: 12 }}>
      Крок {step} з 4 · {FLOW_STEP_LABELS[step - 1]}
    </div>
  )
}

async function reverseGeocodeAddress(point: Point): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&accept-language=uk`,
      { headers: { Accept: "application/json" } },
    )
    if (!response.ok) throw new Error("geocode failed")
    const data = (await response.json()) as { display_name?: string }
    if (data.display_name) {
      return data.display_name.split(",").slice(0, 3).join(",").trim()
    }
  } catch {
    // fall through to coordinates
  }
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}

function resolveServiceDestination(service: ServiceKey, pickup: Point): { destination: string; destinationPoint: Point } {
  if (service === "tow") {
    return { destination: "СТО «Авторемонт»", destinationPoint: DEFAULT_DESTINATION }
  }
  return { destination: "На місці обслуговування", destinationPoint: pickup }
}

function resolveOrderDistanceKm(service: ServiceKey, pickup: Point, destinationPoint: Point): number {
  const raw = calculateDistanceKm(pickup, destinationPoint)
  return service === "tow" ? raw : Math.max(0.5, raw)
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

function AppShell({ children, compact, role, onRoleChange, onOpenCabinet, onSwitchRole }: { children: React.ReactNode; compact: boolean; role: Role | null; onRoleChange: (role: Role | null) => void; onOpenCabinet?: () => void; onSwitchRole?: () => void }) {
  const roleLabels: Record<Exclude<Role, null>, string> = { customer: "Клієнт", provider: "Партнер", admin: "Адмін" }

  if (compact) {
    return (
      <div className="pomich-tg-app flex flex-col">
        {role ? (
          <header className="pomich-tg-header flex h-11 shrink-0 items-center justify-between px-3 gap-2">
            <button type="button" onClick={() => onRoleChange(null)} className="pomich-app-header-menu-btn">← Меню</button>
            <div className="pomich-app-header-role-label">{roleLabels[role]}</div>
            <div className="flex items-center gap-1.5 shrink-0">
              <ThemeToggle compact />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--compact">Кабінет</button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--compact">Роль</button>
              ) : null}
            </div>
          </header>
        ) : null}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
      </div>
    )
  }

  return (
    <div className="pomich-themed-shell min-h-dvh">
      {role ? (
        <header className="pomich-tg-header relative z-[1400] flex h-[62px] shrink-0 items-center justify-center px-6">
          <div className="flex w-full max-w-7xl items-center justify-between gap-4">
            <a href="/" className="pomich-app-header-brand text-xl">POMICH</a>
            <div className="flex items-center gap-2 overflow-x-auto">
              {[
                { key: "customer", label: "Клієнт" },
                { key: "provider", label: "Партнер" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onRoleChange(item.key as Role)}
                  className={`pomich-app-header-chip pomich-app-header-chip--regular${role === item.key ? " is-active" : ""}`}
                >
                  {item.label}
                </button>
              ))}
              <ThemeToggle />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--regular">Кабінет</button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--regular">Змінити роль</button>
              ) : null}
            </div>
          </div>
        </header>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}

function ScreenLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="pomich-themed-shell" style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: "100%", minHeight: "100%", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", overflowX: "hidden" }}>{children}</div>
      {footer ? <FormFooterBar>{footer}</FormFooterBar> : null}
    </div>
  )
}

function Header({ title, subtitle, onBack, status }: { title: string; subtitle?: string; onBack?: () => void; status?: OrderStatus }) {
  return (
    <FormHeader>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {onBack ? <button type="button" aria-label="Назад" onClick={onBack} className="pomich-back-btn">←</button> : null}
          <div style={{ minWidth: 0 }}>
            <div className="pomich-header-title">{title}</div>
            {subtitle ? <div className="pomich-header-subtitle">{subtitle}</div> : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <ThemeToggle compact />
          {status ? <StatusPill status={status} /> : null}
        </div>
      </div>
    </FormHeader>
  )
}

function isolatePanelWheel(event: React.WheelEvent<HTMLElement>) {
  event.stopPropagation()
}

function RideScreen({
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
  children,
}: {
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
  children: React.ReactNode
}) {
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTablet = useMediaQuery(mediaQueries.tablet)
  const isDesktop = useMediaQuery(mediaQueries.desktop)
  const isTelegram = useMemo(() => getTelegramContext().isTelegram, [])
  const sheetCompact = isTelegram || isMobile
  const splitView = isTablet || isDesktop

  if (splitView) {
    return (
      <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#DDE7E2]">
        <div className="relative min-w-0 flex-1">
          <RouteMap pickup={pickup} destination={destination} providers={providers} providerPosition={providerPosition} requestPins={requestPins} subtitle={mapSubtitle} full showAllProviders={showAllProviders} userLocation={userLocation ?? pickup} onUserLocationChange={onUserLocationChange} onPick={onPick} onAcceptRequest={onAcceptRequest} onContactRequest={onContactRequest} />
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
      <RouteMap pickup={pickup} destination={destination} providers={providers} providerPosition={providerPosition} requestPins={requestPins} subtitle={mapSubtitle} full showAllProviders={showAllProviders} userLocation={userLocation ?? pickup} onUserLocationChange={onUserLocationChange} onPick={onPick} onAcceptRequest={onAcceptRequest} onContactRequest={onContactRequest} />
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
        className={`pomich-sheet-panel absolute bottom-0 left-0 right-0 z-[1300] overflow-y-auto shadow-2xl ${sheetCompact ? "tg-sheet-compact rounded-t-2xl" : "max-h-[min(70%,calc(100%-env(safe-area-inset-top,0px)-56px))] rounded-t-3xl"}`}
        style={{
          maxHeight: sheetCompact ? "min(55%, calc(100% - env(safe-area-inset-top, 0px) - 48px))" : undefined,
          padding: sheetCompact ? "6px 12px calc(12px + env(safe-area-inset-bottom, 0px))" : "10px 16px calc(16px + env(safe-area-inset-bottom, 0px))",
        }}
        onWheel={isolatePanelWheel}
      >
        <div className={`mx-auto rounded-full bg-gray-300 ${sheetCompact ? "mb-2 h-1 w-10" : "mb-3.5 h-1 w-12"}`} />
        {children}
      </div>
    </div>
  )
}

function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTelegram = useMemo(() => getTelegramContext().isTelegram, [])
  const compact = isTelegram || isMobile
  return (
    <div>
      <div style={{ fontSize: compact ? 20 : 24, lineHeight: 1.08, fontWeight: 950, color: DARK }}>{title}</div>
      {subtitle ? <div style={{ marginTop: compact ? 5 : 7, color: "#6B7280", fontSize: compact ? 13 : 14, lineHeight: 1.35, fontWeight: 750 }}>{subtitle}</div> : null}
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
  customerToken,
  isTelegram,
  onChange,
  onVerify,
  onVerified,
}: {
  profile: CustomerProfile
  saving: boolean
  error?: string
  customerToken?: string
  isTelegram?: boolean
  onChange: (patch: Partial<CustomerProfile>) => void
  onVerify: () => void
  onVerified: (profile: CustomerProfile) => void
}) {
  const checklist = getProfileChecklist(profile)
  const initials = (profile.name || "POMICH").trim().slice(0, 1).toUpperCase()
  const phoneDisplay = profile.phone?.trim()
    ? `+380 ${formatLocalPhoneDisplay(nationalDigitsFromPhone(profile.phone))}`
    : "Не вказано"
  const nameDisplay = profile.name?.trim() || "Клієнт POMICH"
  const profileTone = customerProfileStatusTone(profile)

  return (
    <div style={{ background: "#fff", borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, minWidth: 0, alignItems: "flex-start" }}>
        <div style={{ width: 48, height: 48, borderRadius: 999, background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, fontSize: 20, flex: "0 0 auto" }}>{initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: DARK, fontWeight: 950, fontSize: 15 }}>Ваш профіль</div>
          <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800, marginTop: 3 }}>{nameDisplay} · {phoneDisplay}</div>
          <div style={{ marginTop: 7 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: profileTone.background, border: `1px solid ${profileTone.border}`, color: profileTone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: profileTone.color }} />
              {customerProfileStatusLabel(profile)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Ім'я *</span>
          <input value={profile.name || ""} onChange={(event) => onChange({ name: event.target.value })} placeholder="Ваше ім'я" className="pomich-form-input" style={{ color: DARK }} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Телефон *</span>
          <PhoneInput value={profile.phone || ""} onChange={(phone) => onChange({ phone })} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Email</span>
          <input value={profile.email || ""} onChange={(event) => onChange({ email: event.target.value })} inputMode="email" placeholder="email@example.com" className="pomich-form-input" style={{ color: DARK }} />
        </label>
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 12, background: "#F9FAFB" }}>
        <div style={{ fontWeight: 950, fontSize: 13, color: DARK, marginBottom: 8 }}>{profileChecklistSummary(profile)}</div>
        <div style={{ display: "grid", gap: 6 }}>
          {checklist.map((item) => (
            <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 800 }}>
              <span style={{ color: "#374151" }}>{item.label}{item.required ? " *" : ""}</span>
              <span style={{ color: item.filled ? BRAND : "#9CA3AF" }}>{item.filled ? "✓ Заповнено" : "— Потрібно"}</span>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onVerify} disabled={saving || !isCustomerProfileComplete(profile)} style={{ minHeight: 42, borderRadius: 14, border: "none", background: saving || !isCustomerProfileComplete(profile) ? "#E5E7EB" : BRAND, color: saving || !isCustomerProfileComplete(profile) ? "#6B7280" : "#fff", fontFamily: "inherit", fontWeight: 950, cursor: saving || !isCustomerProfileComplete(profile) ? "not-allowed" : "pointer" }}>
        {saving ? "Зберігаємо…" : "Зберегти профіль"}
      </button>
      {!isCustomerVerified(profile) && isCustomerProfileComplete(profile) ? (
        <OtpVerificationPanel
          profile={profile}
          customerToken={customerToken}
          isTelegram={isTelegram}
          phone={profile.phone}
          email={profile.email}
          compact
          onVerified={onVerified}
        />
      ) : null}
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
  customerToken,
  isTelegram,
  onProfileChange,
  onVerifyCustomer,
  onProfileVerified,
  onRetryGeo,
  onSelect,
}: {
  pickup: Point
  locationLabel: string
  providers: ProviderAvailability[]
  providersLoading: boolean
  customerProfile: CustomerProfile
  customerVerificationSaving: boolean
  customerVerificationError?: string
  customerToken?: string
  isTelegram?: boolean
  onProfileChange: (patch: Partial<CustomerProfile>) => void
  onVerifyCustomer: () => void
  onProfileVerified: (profile: CustomerProfile) => void
  onRetryGeo: () => void
  onSelect: (service: ServiceKey) => void
}) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const profileReady = isCustomerReadyForOrder(customerProfile)
  const geoFailed = locationLabel.includes("Не вдалося")

  const handleSelect = (service: ServiceKey) => {
    if (!profileReady) return
    onSelect(service)
  }

  return (
    <RideScreen pickup={pickup} providers={providers} mapSubtitle={`${locationLabel} · Ужгород`} showAllProviders>
      <StepBadge step={1} />
      <SheetHeading title="Потрібна допомога на дорозі?" subtitle="Спочатку заповніть профіль, потім оберіть проблему." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="●" title="Поточне місце" subtitle={locationLabel} active />
        <SheetDivider />
        <LocationRow icon="🏁" title="Куди везти або де ремонтувати" subtitle="Уточнимо після вибору послуги" />
      </div>

      {geoFailed ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          <div style={{ background: "#FFF7ED", color: "#B45309", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800 }}>
            Не вдалося визначити геолокацію. Спробуйте ще раз або оберіть точку на карті під час оформлення заявки.
          </div>
          <button onClick={onRetryGeo} style={{ minHeight: 42, border: `1px solid ${BORDER}`, borderRadius: 12, background: "#fff", color: DARK, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>
            📍 Спробувати знову
          </button>
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <CustomerTrustPanel profile={customerProfile} saving={customerVerificationSaving} error={customerVerificationError} customerToken={customerToken} isTelegram={isTelegram} onChange={onProfileChange} onVerify={onVerifyCustomer} onVerified={onProfileVerified} />
      </div>

      {!profileReady ? (
        <div style={{ marginTop: 12, background: "#EFF6FF", color: "#1D4ED8", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800 }}>
          {isCustomerProfileComplete(customerProfile)
            ? "Підтвердіть профіль кодом з Telegram або email, щоб викликати допомогу."
            : "Заповніть ім'я та телефон, щоб викликати допомогу."}
        </div>
      ) : null}

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
          <button key={service.key} onClick={() => handleSelect(service.key as ServiceKey)} disabled={!profileReady} style={{ minHeight: 64, display: "grid", gridTemplateColumns: "44px 1fr auto", alignItems: "center", gap: 12, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "11px 12px", background: profileReady ? "#fff" : "#F3F4F6", textAlign: "left", cursor: profileReady ? "pointer" : "not-allowed", fontFamily: "inherit", boxShadow: profileReady ? "0 8px 22px rgba(17,19,21,0.04)" : "none", opacity: profileReady ? 1 : 0.7 }}>
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

function LocationStep({
  pickup,
  addressLabel,
  geoMessage,
  onPick,
  onRetryGeo,
  onBack,
  onNext,
}: {
  pickup: Point
  addressLabel: string
  geoMessage: string
  onPick: (point: Point) => void
  onRetryGeo: () => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <RideScreen pickup={pickup} mapSubtitle="Точка подачі · натисніть на карту" onPick={onPick}>
      <StepBadge step={2} />
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Підтвердьте місце" subtitle="Перетягніть точку на карті або натисніть, щоб уточнити. Партнер побачить лише приблизну адресу." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: "#F9FAFB" }}>
        <LocationRow icon="📍" title="Адреса" subtitle={addressLabel} active />
        <SheetDivider />
        <LocationRow icon="🛰️" title="Статус геолокації" subtitle={geoMessage} />
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={onRetryGeo} type="button" style={{ width: "100%", minHeight: 42, border: `1px solid ${BORDER}`, borderRadius: 12, background: "#fff", color: DARK, fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>
          📍 Оновити геолокацію
        </button>
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

function PriceStep({
  serviceLabel,
  breakdown,
  pickup,
  destination,
  etaMinutes,
  loading,
  onConfirm,
  onBack,
}: {
  serviceLabel: string
  breakdown: ReturnType<typeof calculatePrice>
  pickup: Point
  destination: Point
  etaMinutes: number
  loading: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle={`~${etaMinutes} хв · ~${breakdown.price.toLocaleString("uk-UA")} ₴`}>
      <StepBadge step={3} />
      <button onClick={onBack} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Отримайте ETA і ціну" subtitle="Перевірте орієнтовний час прибуття та вартість перед підтвердженням." />

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "#111315", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>ETA</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>~{etaMinutes} хв</div>
        </div>
        <div style={{ background: "#111315", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Ціна</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>~{breakdown.price.toLocaleString("uk-UA")} ₴</div>
        </div>
      </div>

      <div style={{ marginTop: 12, background: "#111315", color: "#fff", borderRadius: 22, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#A7F3D0", fontWeight: 900, fontSize: 13 }}>{serviceLabel}</div>
            <div style={{ fontSize: 34, fontWeight: 950, marginTop: 6 }}>{breakdown.price.toLocaleString("uk-UA")} ₴</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.12)", borderRadius: 999, padding: "8px 11px", fontSize: 13, fontWeight: 900 }}>~{etaMinutes} хв</div>
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
        <PrimaryButton label="Підтвердити заявку" onClick={onConfirm} loading={loading} disabled={loading} />
      </div>
    </RideScreen>
  )
}

function SearchingStep({ orderId, status, order, pickup, destination, onCancel, onRetryDispatch }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onCancel: () => void; onRetryDispatch: () => void }) {
  const noProviders = order?.dispatchState === "NO_PROVIDERS_AVAILABLE"
  const offersSent = order?.dispatchInfo?.offersSent ?? order?.offers?.length ?? 0
  return (
    <RideScreen pickup={pickup} destination={destination} providers={order?.assignedProvider ? [order.assignedProvider] : undefined} mapSubtitle={orderId ? `#${orderId}` : "Пошук поруч"}>
      <StepBadge step={4} />
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

function AssignedStep({ orderId, status, order, pickup, destination, onTrack, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onTrack: () => void; onCancel: () => void }) {
  const assignedProvider = order?.assignedProvider
  return (
    <RideScreen pickup={pickup} destination={destination} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Виконавець призначений">
      <StepBadge step={4} />
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
  const liveProviderLocation = order?.assignedProvider?.location
  const start = liveProviderLocation ? { lat: liveProviderLocation.lat, lng: liveProviderLocation.lng } : (order?.assignedProvider ? PROVIDER_START : PROVIDER_START)
  const providerPosition = liveProviderLocation
    ? { lat: liveProviderLocation.lat, lng: liveProviderLocation.lng }
    : interpolate(start, pickup, Math.min(progress, 92))
  const eta = order?.assignedProvider?.etaMinutes ?? Math.max(1, Math.ceil((100 - progress) / 12))

  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={providerPosition} mapSubtitle={`ETA ${eta} хв · ${Math.round(progress)}% маршруту`}>
      <StepBadge step={4} />
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

function ArrivedStep({ orderId, status, order, pickup, destination, onComplete, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onComplete: () => void; onCancel: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={pickup} mapSubtitle="Виконавець на місці">
      <StepBadge step={4} />
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

function InProgressStep({ orderId, status, order, pickup, destination, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onCancel: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={pickup} mapSubtitle="Допомога триває">
      <StepBadge step={4} />
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
  onRegister,
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
  onRegister?: () => void
}) {
  return (
    <ScreenLayout footer={<PrimaryButton label={saving ? "Входимо…" : "Увійти"} onClick={onSubmit} disabled={!login.trim() || !password.trim() || saving} />}>
      <Header title={title} subtitle={subtitle} />
      <FormContainer>
        <div className="pomich-form-card">
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Логін</span>
            <input value={login} onChange={(event) => onLoginChange(event.target.value)} autoComplete="username" className="pomich-form-input" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Пароль</span>
            <input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete="current-password" className="pomich-form-input" />
          </label>
        </div>
        {onRegister ? (
          <button type="button" onClick={onRegister} className="pomich-ghost-btn" style={{ width: "100%", color: "var(--pomich-accent)" }}>
            Новий партнер? Зареєструватись
          </button>
        ) : null}
        {error ? <div className="pomich-form-error">{error}</div> : null}
      </FormContainer>
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
  onLogin,
}: {
  form: PartnerRegistrationForm
  saving: boolean
  error?: string
  onChange: (patch: Partial<PartnerRegistrationForm>) => void
  onToggleSpecialty: (specialty: ServiceKey) => void
  onSubmit: () => void
  onLogin?: () => void
}) {
  const canSubmit = Boolean(
    form.name.trim()
    && validateUkraineMobilePhone(form.phone).valid
    && form.vehicle.trim()
    && (form.city || "").trim()
    && form.specialties.length > 0,
  )
  const documentsReady = Boolean(form.identityDocumentRef.trim() && form.driverLicenseRef.trim() && form.vehicleRegistrationRef.trim() && form.serviceProofRef.trim() && form.selfieRef.trim())

  return (
    <ScreenLayout footer={<PrimaryButton label={saving ? "Зберігаємо профіль…" : "Зареєструватись"} onClick={onSubmit} disabled={!canSubmit || saving} />}>
      <Header title="Реєстрація партнера" subtitle="Заповніть профіль і оберіть послуги, які надаєте" />
      <FormContainer>
        <div className="pomich-form-card">
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Ім'я</span>
            <input value={form.name} onChange={(event) => onChange({ name: event.target.value })} className="pomich-form-input" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Телефон</span>
            <PhoneInput value={form.phone} onChange={(phone) => onChange({ phone })} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Місто</span>
            <input value={form.city} onChange={(event) => onChange({ city: event.target.value })} placeholder="Ужгород" className="pomich-form-input" />
          </label>
        </div>

        <div className="pomich-form-card">
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Авто / марка</span>
            <input value={form.vehicle} onChange={(event) => onChange({ vehicle: event.target.value })} placeholder="Volkswagen Transporter" className="pomich-form-input" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span className="pomich-form-label">Номер</span>
            <input value={form.plate} onChange={(event) => onChange({ plate: event.target.value })} className="pomich-form-input" />
          </label>
          <ServiceRadiusField value={form.serviceRadiusKm} onChange={(serviceRadiusKm) => onChange({ serviceRadiusKm })} />
        </div>

        <div className="pomich-form-card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 950, color: "var(--pomich-text)" }}>Ваші послуги</div>
              <div className="pomich-header-subtitle">{form.specialties.length} обрано</div>
            </div>
            <div style={{ background: form.specialties.length > 0 ? "var(--pomich-selected-bg)" : "#FFF7ED", color: form.specialties.length > 0 ? BRAND : "#B45309", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 950 }}>
              {form.specialties.length > 0 ? "Готово" : "Оберіть"}
            </div>
          </div>
          <div className="pomich-service-grid">
            {partnerRegistrationServices.map((service) => {
              const selected = form.specialties.includes(service.key)
              return (
                <button key={service.key} type="button" onClick={() => onToggleSpecialty(service.key)} className={`pomich-service-card${selected ? " is-selected" : ""}`} style={selected ? undefined : { background: service.tone }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 18 }}>{service.emoji}</span>
                    <span style={{ fontWeight: 900, fontSize: 13, lineHeight: 1.2 }}>{getProviderCapabilityLabel(service.key)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {onLogin ? (
          <button type="button" onClick={onLogin} className="pomich-link-btn" style={{ width: "100%" }}>
            Вже маєте акаунт? Увійти
          </button>
        ) : null}

        {documentsReady ? (
          <div className="pomich-form-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 950, color: "var(--pomich-text)" }}>Перевірка партнера</div>
                <div className="pomich-header-subtitle">Допуск до заявок після review диспетчера</div>
              </div>
              <div style={{ borderRadius: 999, padding: "7px 10px", background: "var(--pomich-selected-bg)", color: BRAND, fontSize: 12, fontWeight: 950 }}>Готово</div>
            </div>
            {[
              ["identityDocumentRef", "ID / паспорт", "doc://passport-front"],
              ["driverLicenseRef", "Водійське посвідчення", "doc://driver-license"],
              ["vehicleRegistrationRef", "Реєстрація авто", "doc://vehicle-registration"],
              ["serviceProofRef", "Підтвердження сервісу", "doc://tools-or-company"],
              ["selfieRef", "Selfie-check", "doc://selfie"],
            ].map(([key, label, placeholder]) => (
              <label key={key} style={{ display: "grid", gap: 6 }}>
                <span className="pomich-form-label">{label}</span>
                <input value={String(form[key as keyof PartnerRegistrationForm] ?? "")} onChange={(event) => onChange({ [key]: event.target.value } as Partial<PartnerRegistrationForm>)} placeholder={placeholder} className="pomich-form-input" />
              </label>
            ))}
          </div>
        ) : null}

        {error ? <div className="pomich-form-error">{error}</div> : null}
      </FormContainer>
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

const LANDING_MAP_CENTER: Point = PICKUP
const LANDING_DESTINATION: Point = { lat: 48.625, lng: 22.295 }

const landingHeroProviders: ProviderAvailability[] = [
  {
    id: "hero-oleksandr",
    name: "Олександр",
    status: "online",
    vehicle: "Volkswagen Transporter",
    rating: 4.9,
    etaMinutes: 12,
    location: { lat: 48.618, lng: 22.282 },
    specialties: ["tow", "fuel"],
  },
  {
    id: "hero-mykhailo",
    name: "Михайло",
    status: "busy",
    vehicle: "Renault Master",
    rating: 4.8,
    etaMinutes: 18,
    location: { lat: 48.628, lng: 22.301 },
    specialties: ["battery", "wheel"],
  },
]

function readLandingUserLocation(): Point | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const raw = window.sessionStorage.getItem("pomichLandingGeo")
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { lat?: number; lng?: number }
    if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
      return { lat: parsed.lat, lng: parsed.lng }
    }
  } catch {
    return undefined
  }
  return undefined
}

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

type LandingTheme = {
  page: string
  section: string
  sectionAlt: string
  nav: string
  navBorder: string
  text: string
  muted: string
  subtle: string
  navText: string
  badgeBg: string
  badgeBorder: string
  badgeText: string
  cardBorder: string
  cardShadow: string
  ghostBg: string
  ghostBorder: string
  footer: string
  menu: string
  heroFadeBottom: string
  heroGradientText: string
  statValue: string
  mapOverlay: string
  heroBg: string
  heroPattern: string
}

function buildLandingTheme(mode: PomichThemeMode, colors: PomichThemeColors): LandingTheme {
  const isDark = mode === "dark"
  return {
    page: colors.bg,
    section: colors.section,
    sectionAlt: colors.sectionAlt,
    nav: colors.nav,
    navBorder: colors.navBorder,
    text: colors.text,
    muted: colors.muted,
    subtle: colors.subtle,
    navText: isDark ? "#9CA3AF" : colors.muted,
    badgeBg: isDark ? "rgba(22,163,106,0.12)" : "#EAFBF2",
    badgeBorder: isDark ? "rgba(22,163,106,0.38)" : "#A8EBC7",
    badgeText: colors.badgeText,
    cardBorder: colors.glassCardBorder,
    cardShadow: colors.cardShadow,
    ghostBg: colors.ghostBg,
    ghostBorder: colors.ghostBorder,
    footer: isDark ? colors.bg : "#EEF4F8",
    menu: isDark ? "rgba(15,18,22,0.98)" : "rgba(255,255,255,0.98)",
    heroFadeBottom: colors.heroFadeBottom,
    heroGradientText: colors.heroGradientText,
    statValue: isDark ? "#FACC15" : colors.brand,
    mapOverlay: isDark
      ? "linear-gradient(180deg, rgba(9,11,14,0.06), rgba(9,11,14,0.28))"
      : "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.16))",
    heroBg: colors.heroBg,
    heroPattern: colors.heroPattern,
  }
}

function landingCardSurface(theme: LandingTheme): { border: string; background: string; boxShadow: string } {
  return {
    border: `1px solid ${theme.cardBorder}`,
    background: "var(--pomich-glass-card)",
    boxShadow: theme.cardShadow,
  }
}

function LandingBadge({ label, theme }: { label: string; theme: LandingTheme }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${theme.badgeBorder}`, background: theme.badgeBg, color: theme.badgeText, borderRadius: 999, padding: "8px 12px", fontWeight: 900, fontSize: 13 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: "#22C55E", boxShadow: "0 0 18px rgba(34,197,94,0.85)" }} />
      {label}
    </span>
  )
}

function LandingButton({ children, onClick, theme, variant = "primary", compact = false }: { children: React.ReactNode; onClick?: () => void; theme: LandingTheme; variant?: "primary" | "secondary" | "ghost"; compact?: boolean }) {
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"
  return (
    <button
      onClick={onClick}
      style={{
        minHeight: compact ? 44 : 50,
        border: isGhost ? `1px solid ${theme.ghostBorder}` : "none",
        borderRadius: compact ? 10 : 12,
        padding: compact ? "0 14px" : "0 18px",
        fontSize: compact ? 14 : undefined,
        background: isPrimary ? "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)" : isGhost ? theme.ghostBg : "linear-gradient(135deg, #2F80ED 0%, #D6B400 100%)",
        color: isGhost ? theme.text : "#fff",
        boxShadow: isGhost ? "none" : "0 16px 38px rgba(22,163,106,0.22)",
        fontFamily: "inherit",
        fontWeight: 950,
        cursor: "pointer",
        width: "100%",
      }}
    >
      {children}
    </button>
  )
}

function LandingSectionTitle({ eyebrow, title, subtitle, theme, compact = false }: { eyebrow: string; title: string; subtitle: string; theme: LandingTheme; compact?: boolean }) {
  return (
    <div className="landing-section-title pomich-landing-inner" style={{ textAlign: "center", margin: compact ? "0 auto 14px" : "0 auto 34px" }}>
      <div style={{ display: "inline-flex", border: "1px solid rgba(47,128,237,0.42)", background: "rgba(47,128,237,0.14)", color: "#69A7FF", borderRadius: 999, padding: compact ? "5px 10px" : "7px 12px", fontWeight: 900, fontSize: compact ? 11 : 13 }}>{eyebrow}</div>
      <h2 style={{ margin: compact ? "10px 0 0" : "18px 0 0", color: theme.text, fontSize: compact ? 22 : "clamp(28px, 4vw, 42px)", lineHeight: 1.03, letterSpacing: 0, fontWeight: 950 }}>{title}</h2>
      <p style={{ margin: compact ? "8px auto 0" : "14px auto 0", color: theme.muted, fontSize: compact ? 13 : 17, lineHeight: compact ? 1.45 : 1.55, fontWeight: 700 }}>{subtitle}</p>
    </div>
  )
}

function LandingHeroBackground({
  providers,
  theme,
  isDark,
}: {
  providers: ProviderAvailability[]
  theme: LandingTheme
  isDark: boolean
}) {
  const heroProviders = providers.length > 0 ? providers : landingHeroProviders
  return (
    <>
      {isDark ? (
        <>
          <div style={{ position: "absolute", inset: 0, opacity: 0.4, filter: "saturate(1.18) contrast(1.05)", pointerEvents: "none" }}>
            <RouteMap
              pickup={LANDING_MAP_CENTER}
              destination={LANDING_DESTINATION}
              providers={heroProviders}
              subtitle="POMICH live map"
              full
              showBadges={false}
              directoryOnly
              decorative
            />
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: theme.heroBg,
              pointerEvents: "none",
            }}
          />
        </>
      ) : (
        <>
          <div style={{ position: "absolute", inset: 0, background: theme.heroBg, pointerEvents: "none" }} />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(ellipse 90% 70% at 50% 0%, rgba(22,163,106,0.14), transparent 58%)",
              pointerEvents: "none",
            }}
          />
        </>
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: theme.heroPattern,
          backgroundSize: "28px 28px",
          opacity: isDark ? 0.55 : 0.45,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 140, background: theme.heroFadeBottom, pointerEvents: "none" }} />
    </>
  )
}

function LandingPage({
  onSelect,
  onRegister,
  onLogin,
}: {
  onSelect: (role: Role) => void
  onRegister: () => void
  onLogin: () => void
}) {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTelegram = telegramContext.isTelegram
  const layoutCompact = isTelegram || isMobile
  const [menuOpen, setMenuOpen] = useState(false)
  const [mapProviders, setMapProviders] = useState<ProviderAvailability[]>([])
  const [mapProvidersLoading, setMapProvidersLoading] = useState(true)
  const [mapUserLocation, setMapUserLocation] = useState<Point | undefined>(() => readLandingUserLocation())
  const [mapGeoStatus, setMapGeoStatus] = useState<"idle" | "requesting" | "success" | "error">(() => (readLandingUserLocation() ? "success" : "idle"))
  const { mode, colors, isDark } = usePomichTheme()
  const theme = buildLandingTheme(mode, colors)
  const navItems = [
    ["#home", "Головна"],
    ["#services", "Послуги"],
    ["#steps", "Як це працює"],
    ["#map", "Карта"],
    ["#contacts", "Контакти"],
  ] as const

  useEffect(() => {
    let cancelled = false
    getMapProviders()
      .then((items) => {
        if (!cancelled) setMapProviders(items)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setMapProvidersLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const requestMapGeo = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setMapGeoStatus("error")
      return
    }
    setMapGeoStatus("requesting")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        window.sessionStorage.setItem("pomichLandingGeo", JSON.stringify(point))
        setMapUserLocation(point)
        setMapGeoStatus("success")
      },
      () => setMapGeoStatus("error"),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const mapProviderCount = mapProviders.length

  return (
    <div className={isTelegram ? "tg-compact pomich-landing" : "pomich-landing"} style={{ minHeight: "100dvh", background: theme.page, color: theme.text, overflowX: "hidden", overflowY: "auto" }}>
      <header className="pomich-landing-header" style={{ height: layoutCompact ? 52 : 66, borderBottom: "1px solid var(--pomich-nav-border)", background: "var(--pomich-nav)", padding: layoutCompact ? "0 12px" : "0 28px" }}>
        <div style={{ width: "100%", maxWidth: 1070, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
          <a href="#home" style={{ display: "inline-flex", alignItems: "center", gap: layoutCompact ? 8 : 12, color: "var(--pomich-text)", textDecoration: "none", fontWeight: 950 }}>
            <span style={{ width: layoutCompact ? 34 : 42, height: layoutCompact ? 34 : 42, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", boxShadow: "0 12px 32px rgba(22,163,106,0.28)", fontSize: layoutCompact ? 16 : 20 }}>P</span>
            <span style={{ fontSize: layoutCompact ? 16 : 20 }}>POMICH</span>
          </a>
          {layoutCompact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ThemeToggle compact={layoutCompact} />
              <button aria-label="Меню" onClick={() => setMenuOpen((value) => !value)} style={{ width: 44, height: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 10, background: theme.ghostBg, color: theme.text, fontSize: 22, fontWeight: 900, cursor: "pointer" }}>☰</button>
            </div>
          ) : (
            <nav style={{ display: "flex", alignItems: "center", gap: 26 }}>
              {navItems.map(([href, label]) => (
                <a key={href} href={href} className="pomich-landing-nav-link">{label}</a>
              ))}
            </nav>
          )}
          {!layoutCompact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ThemeToggle compact={layoutCompact} />
              <LandingButton theme={theme} variant="ghost" onClick={onLogin}>Увійти</LandingButton>
              <LandingButton theme={theme} onClick={onRegister}>Зареєструватися</LandingButton>
            </div>
          ) : null}
        </div>
        {layoutCompact && menuOpen ? (
          <div style={{ position: "absolute", top: 52, left: 12, right: 12, border: `1px solid ${theme.ghostBorder}`, borderRadius: 8, background: theme.menu, padding: 12, display: "grid", gap: 4, boxShadow: "0 24px 60px rgba(0,0,0,0.32)" }}>
            {navItems.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ color: theme.text, textDecoration: "none", fontWeight: 900, padding: "10px 10px", borderRadius: 6, fontSize: 14 }}>{label}</a>
            ))}
            <button type="button" onClick={() => { setMenuOpen(false); onLogin() }} style={{ marginTop: 6, minHeight: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 8, background: theme.ghostBg, color: theme.text, fontFamily: "inherit", fontWeight: 900, cursor: "pointer" }}>Увійти</button>
            <button type="button" onClick={() => { setMenuOpen(false); onRegister() }} style={{ minHeight: 44, border: "none", borderRadius: 8, background: "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)", color: "#fff", fontFamily: "inherit", fontWeight: 900, cursor: "pointer" }}>Зареєструватися</button>
          </div>
        ) : null}
      </header>

      <main>
        <section id="home" style={{ position: "relative", minHeight: layoutCompact ? "520px" : "680px", display: "flex", alignItems: "center", justifyContent: "center", padding: layoutCompact ? "20px 12px 16px" : "72px 24px 48px", overflow: "hidden" }}>
          <LandingHeroBackground providers={mapProviders} theme={theme} isDark={isDark} />
          <div className="pomich-landing-inner" style={{ position: "relative", zIndex: 2, width: "100%", textAlign: "center" }}>
            <LandingBadge label="Автодопомога в Ужгороді та по Україні" theme={theme} />
            <h1 className="landing-hero-title" style={{ margin: layoutCompact ? "12px 0 0" : "28px 0 0", fontSize: layoutCompact ? 24 : "clamp(34px, 5vw, 48px)", lineHeight: layoutCompact ? 1.08 : 1.02, letterSpacing: 0, fontWeight: 950, color: theme.text }}>
              Ласкаво просимо до
              <br />
              <span className="pomich-brand-gradient-text">POMICH</span>
            </h1>
            <p style={{ margin: layoutCompact ? "10px auto 0" : "24px auto 0", maxWidth: 420, color: theme.muted, fontSize: layoutCompact ? 14 : 17, lineHeight: layoutCompact ? 1.4 : 1.55, fontWeight: 700 }}>
              Маркетплейс автодопомоги: евакуатор, шиномонтаж, запуск акумулятора, пальне та механік. Перегляньте послуги, карту партнерів і ціни — реєстрація лише коли будете готові викликати допомогу.
            </p>
            <div style={{ margin: layoutCompact ? "12px auto 0" : "24px auto 0", color: theme.badgeText, fontSize: 13, fontWeight: 950 }}>Оберіть вашу роль</div>
            <div style={{ margin: "10px auto 0", display: "grid", gap: layoutCompact ? 8 : 10 }}>
              <LandingButton theme={theme} compact={layoutCompact} onClick={() => onSelect("customer")}>Потрібна допомога</LandingButton>
              <LandingButton theme={theme} compact={layoutCompact} variant="secondary" onClick={() => onSelect("provider")}>Надаю послуги</LandingButton>
            </div>
            <div style={{ margin: layoutCompact ? "8px auto 0" : "12px auto 0" }}>
              <a href="https://t.me/pomich_ua_bot" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                <LandingButton theme={theme} compact={layoutCompact} variant="ghost">@pomich_ua_bot</LandingButton>
              </a>
            </div>
            <div style={{ margin: layoutCompact ? "16px auto 0" : "32px auto 0", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: layoutCompact ? 8 : 20 }}>
              {landingStats.map(([value, label]) => (
                <div key={value}>
                  <div style={{ color: theme.statValue, fontSize: layoutCompact ? 20 : 28, fontWeight: 950 }}>{value}</div>
                  <div style={{ marginTop: layoutCompact ? 4 : 6, color: theme.subtle, fontSize: layoutCompact ? 10 : 12, fontWeight: 800 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="services" className="pomich-landing-section" style={{ padding: layoutCompact ? "24px 12px" : "76px 24px 96px" }}>
          <LandingSectionTitle theme={theme} eyebrow="Послуги" title="Що можна викликати через POMICH" subtitle="Орієнтовна базова вартість без реєстрації. Точна ціна залежить від відстані та ситуації на дорозі." compact={layoutCompact} />
          <div className="landing-services-grid pomich-landing-inner" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: layoutCompact ? 10 : 12 }}>
            {services.map((service) => {
              const basePrice = calculatePrice(service.key, 0).price
              const cardSurface = landingCardSurface(theme)
              return (
                <div key={service.key} style={{ ...cardSurface, borderRadius: layoutCompact ? 10 : 16, padding: layoutCompact ? 12 : 16, color: theme.text }}>
                  <div style={{ fontSize: layoutCompact ? 24 : 28 }}>{service.emoji}</div>
                  <h3 style={{ margin: layoutCompact ? "8px 0 0" : "10px 0 0", fontSize: layoutCompact ? 14 : 16, fontWeight: 950 }}>{service.label}</h3>
                  <p style={{ margin: "4px 0 0", color: theme.muted, fontSize: layoutCompact ? 12 : 13, fontWeight: 700 }}>від {basePrice} ₴ · +90 ₴/км</p>
                </div>
              )
            })}
          </div>
          <p className="pomich-landing-inner" style={{ margin: layoutCompact ? "16px auto 0" : "24px auto 0", textAlign: "center", color: theme.subtle, fontSize: layoutCompact ? 12 : 14, fontWeight: 700 }}>
            Щоб створити заявку, потрібна реєстрація — це займе хвилину.
          </p>
        </section>

        <section id="steps" className="pomich-landing-section-alt" style={{ padding: layoutCompact ? "24px 12px" : "64px 24px 80px" }}>
          <LandingSectionTitle theme={theme} eyebrow="Як це працює" title="Чотири кроки до допомоги" subtitle="Короткий сценарій для стресової ситуації: без зайвих форм і без телефонних списків." compact={layoutCompact} />
          <div className="landing-steps-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: layoutCompact ? 10 : 12 }}>
            {landingSteps.map(([number, title, text]) => {
              const cardSurface = landingCardSurface(theme)
              return (
                <div key={number} style={{ ...cardSurface, borderRadius: 10, padding: layoutCompact ? 12 : 14, color: theme.text }}>
                  <div className="landing-step-circle" style={{ width: 40, height: 40, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950, fontSize: 15, boxShadow: "0 0 0 4px rgba(47,128,237,0.14)", marginBottom: 8 }}>{number}</div>
                  <h3 style={{ margin: 0, fontSize: layoutCompact ? 14 : 15, fontWeight: 950, lineHeight: 1.2 }}>{title}</h3>
                  <p style={{ margin: "4px 0 0", color: theme.muted, fontSize: layoutCompact ? 12 : 13, lineHeight: 1.4, fontWeight: 700 }}>{text}</p>
                </div>
              )
            })}
          </div>
        </section>

        <section id="map" className="pomich-landing-section" style={{ padding: layoutCompact ? "24px 12px" : "76px 24px 96px" }}>
          <LandingSectionTitle
            theme={theme}
            eyebrow="Карта"
            title="Партнери в Ужгороді"
            subtitle={mapProvidersLoading ? "Завантажуємо довідник…" : `${mapProviderCount} сервісів на карті · перегляд без реєстрації`}
            compact={layoutCompact}
          />
          <div className="landing-map-frame">
            <RouteMap pickup={LANDING_MAP_CENTER} providers={mapProviders} subtitle="Ужгород · довідник сервісів" full directoryOnly userLocation={mapUserLocation} onUserLocationChange={(point) => {
              window.sessionStorage.setItem("pomichLandingGeo", JSON.stringify(point))
              setMapUserLocation(point)
              setMapGeoStatus("success")
            }} />
            <div style={{ position: "absolute", inset: 0, background: theme.mapOverlay, pointerEvents: "none", zIndex: 1150 }} />
            <button
              type="button"
              onClick={requestMapGeo}
              disabled={mapGeoStatus === "requesting"}
              style={{
                position: "absolute",
                zIndex: 1200,
                right: layoutCompact ? 10 : 14,
                bottom: layoutCompact ? 10 : 14,
                minHeight: 36,
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: 999,
                background: "rgba(9,11,14,0.82)",
                color: theme.text,
                padding: "8px 12px",
                fontFamily: "inherit",
                fontWeight: 900,
                fontSize: layoutCompact ? 11 : 12,
                cursor: mapGeoStatus === "requesting" ? "wait" : "pointer",
                backdropFilter: "blur(10px)",
              }}
            >
              {mapGeoStatus === "requesting" ? "Визначаємо…" : mapGeoStatus === "success" ? "Моє місце ✓" : "📍 Моє місце"}
            </button>
          </div>
          <p className="pomich-landing-inner" style={{ margin: layoutCompact ? "12px auto 0" : "18px auto 0", textAlign: "center", color: theme.subtle, fontSize: layoutCompact ? 12 : 13, fontWeight: 700 }}>
            Карта лише для перегляду. Щоб викликати допомогу — зареєструйтесь як клієнт.
            {mapGeoStatus === "error" ? " · Не вдалося визначити місце — спробуйте ще раз." : null}
          </p>
        </section>

        <section id="contacts" className="pomich-landing-section-alt" style={{ padding: layoutCompact ? "24px 12px 32px" : "64px 24px 80px", background: `radial-gradient(circle at 50% 0%, rgba(22,163,106,0.18), transparent 34%), ${theme.sectionAlt}`, textAlign: "center" }}>
          <LandingSectionTitle theme={theme} eyebrow="Контакти" title="Зв'яжіться з POMICH" subtitle="Telegram-бот, реєстрація клієнта або партнера — оберіть зручний спосіб." compact={layoutCompact} />
          <div className="pomich-landing-inner" style={{ display: "grid", gap: layoutCompact ? 10 : 12 }}>
            <a href="https://t.me/pomich_ua_bot" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
              <div style={{ minHeight: layoutCompact ? 56 : 64, borderRadius: layoutCompact ? 10 : 12, color: theme.text, textAlign: "left", padding: layoutCompact ? "12px 14px" : "14px 16px", fontWeight: 950, ...landingCardSurface(theme) }}>
                <span style={{ display: "block", color: isDark ? "#69A7FF" : colors.accentBlue, fontSize: layoutCompact ? 11 : 13 }}>Telegram</span>
                <span style={{ display: "block", marginTop: 4, fontSize: layoutCompact ? 15 : 17 }}>@pomich_ua_bot</span>
              </div>
            </a>
            <button type="button" onClick={() => onSelect("customer")} style={{ minHeight: layoutCompact ? 56 : 64, borderRadius: layoutCompact ? 10 : 12, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: layoutCompact ? "12px 14px" : "14px 16px", fontWeight: 950, ...landingCardSurface(theme) }}>
              <span style={{ display: "block", color: isDark ? "#8EF0BE" : colors.accent, fontSize: layoutCompact ? 11 : 13 }}>Водіям</span>
              <span style={{ display: "block", marginTop: 4, fontSize: layoutCompact ? 15 : 17 }}>Потрібна допомога</span>
            </button>
            <button type="button" onClick={() => onSelect("provider")} style={{ minHeight: layoutCompact ? 56 : 64, borderRadius: layoutCompact ? 10 : 12, color: theme.text, fontFamily: "inherit", cursor: "pointer", textAlign: "left", padding: layoutCompact ? "12px 14px" : "14px 16px", fontWeight: 950, ...landingCardSurface(theme) }}>
              <span style={{ display: "block", color: isDark ? "#69A7FF" : colors.accentBlue, fontSize: layoutCompact ? 11 : 13 }}>Партнерам</span>
              <span style={{ display: "block", marginTop: 4, fontSize: layoutCompact ? 15 : 17 }}>Надаю послуги</span>
            </button>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: `1px solid ${theme.navBorder}`, background: theme.footer, padding: layoutCompact ? "16px 12px" : "28px 24px" }}>
        <div style={{ maxWidth: 1070, margin: "0 auto", display: "flex", flexDirection: layoutCompact ? "column" : "row", justifyContent: "space-between", gap: layoutCompact ? 10 : 16, color: "var(--pomich-nav-text)", fontSize: layoutCompact ? 12 : 13, fontWeight: 800 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", fontWeight: 950 }}>P</span>
            <span>POMICH · Ужгород</span>
          </div>
          <div>© 2026 · @pomich_ua_bot</div>
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
  const [addressLabel, setAddressLabel] = useState("Визначаємо адресу…")
  const [pickup, setPickup] = useState<Point>(PICKUP)
  const [destinationPoint, setDestinationPoint] = useState<Point>(DEFAULT_DESTINATION)
  const [trackingProgress, setTrackingProgress] = useState(12)
  const [nearbyProviders, setNearbyProviders] = useState<ProviderAvailability[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile>(() => {
    if (typeof window !== "undefined") {
      const raw = window.sessionStorage.getItem("pomichBootstrapProfile")
      if (raw) {
        try {
          return { ...(JSON.parse(raw) as CustomerProfile), id: initialCustomerId }
        } catch {
          // ignore invalid bootstrap profile
        }
      }
    }
    return {
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
  }})
  const [customerVerificationSaving, setCustomerVerificationSaving] = useState(false)
  const [customerVerificationError, setCustomerVerificationError] = useState<string | undefined>()

  const orderInput: CustomerOrderInput = {
    service: selectedService,
    customerLocation: addressLabel,
    destination,
    distanceKm: resolveOrderDistanceKm(selectedService, pickup, destinationPoint),
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
    let cancelled = false
    reverseGeocodeAddress(pickup).then((label) => {
      if (!cancelled) setAddressLabel(label)
    })
    return () => {
      cancelled = true
    }
  }, [pickup])

  useEffect(() => {
    if (geoState === "telegram") return
    if (geoState !== "requesting") return
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
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }, [geoState])

  const retryGeolocation = () => {
    if (geoState === "telegram") return
    setGeoState("requesting")
    setGeoMessage("Визначаємо ваше місцезнаходження…")
  }

  useEffect(() => {
    let cancelled = false
    const refreshProviders = () => {
      setProvidersLoading(true)
      getMapProviders()
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
  const orderDistanceKm = useMemo(() => resolveOrderDistanceKm(selectedService, pickup, destinationPoint), [pickup, destinationPoint, selectedService])
  const breakdown = useMemo(() => calculatePrice(selectedService, orderDistanceKm), [orderDistanceKm, selectedService])
  const quoteEtaMinutes = useMemo(() => providerEtaMinutes(pickup, nearbyProviders, breakdown.etaMinutes), [pickup, nearbyProviders, breakdown.etaMinutes])

  const applyPickup = (point: Point, message = "Місце подачі оновлено вручну.") => {
    setPickup(point)
    setGeoState("success")
    setGeoMessage(message)
  }

  const confirmLocationAndQuote = () => {
    const resolved = resolveServiceDestination(selectedService, pickup)
    setDestination(resolved.destination)
    setDestinationPoint(resolved.destinationPoint)
    setScreen("price")
  }

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
        customerLocation: geoState === "success" || geoState === "telegram" ? sanitizeLocation(addressLabel) : sanitizeLocation(orderInput.customerLocation),
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
    const phoneValidation = validateUkraineMobilePhone(customerProfile.phone || "")
    if (!phoneValidation.valid) {
      setCustomerVerificationError(phoneValidation.error || "Введіть коректний номер телефону")
      return
    }

    setCustomerVerificationSaving(true)
    setCustomerVerificationError(undefined)
    try {
      const customerSession = await ensureCustomerSession()
      const savedProfile = await updateCustomerProfile(customerSession.customerId, {
        name: customerProfile.name,
        phone: phoneValidation.e164,
        email: customerProfile.email,
        telegram: customerProfile.telegram,
        city: customerProfile.city,
      }, customerSession.token)
      setCustomerProfile((profile) => ({ ...profile, ...savedProfile }))
      if (typeof window !== "undefined") {
        window.localStorage.setItem("pomichClientName", savedProfile.name || "")
        window.localStorage.setItem("pomichClientVerification", savedProfile.verificationStatus || "unverified")
      }
    } catch {
      setCustomerVerificationError("Не вдалося зберегти профіль. Перевірте з'єднання.")
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

  const { isTelegram, haptic } = useTelegramUx()

  const goBackScreen = useCallback(() => {
    haptic("light")
    if (screen === "location") setScreen("home")
    else if (screen === "price") setScreen("location")
    else setScreen("home")
  }, [screen, haptic])

  const mainButtonOnClick = useCallback(() => {
    switch (screen) {
      case "location":
        haptic("medium")
        confirmLocationAndQuote()
        break
      case "price":
        haptic("medium")
        submitOrder()
        break
      case "assigned":
        haptic("light")
        startTracking()
        break
      case "completed":
      case "cancelled":
        haptic("light")
        restart()
        break
      case "error":
        haptic("light")
        setScreen("price")
        break
      default:
        break
    }
  }, [screen, haptic, submitOrder, startTracking, restart])

  const mainButtonText = useMemo(() => {
    switch (screen) {
      case "location":
        return "Підтвердити місце"
      case "price":
        return "Підтвердити заявку"
      case "assigned":
        return "Дивитися маршрут"
      case "completed":
      case "cancelled":
        return "Нова заявка"
      case "error":
        return "Повторити"
      default:
        return ""
    }
  }, [screen])

  const mainButtonVisible = ["location", "price", "assigned", "completed", "cancelled", "error"].includes(screen)
  const mainButtonEnabled =
    screen === "price" ? !loading :
    mainButtonVisible

  useTelegramMainButton({
    text: mainButtonText,
    visible: isTelegram && mainButtonVisible,
    enabled: mainButtonEnabled,
    loading: screen === "price" && loading,
    onClick: mainButtonOnClick,
  })

  useTelegramBackButton({
    visible: isTelegram && ["location", "price"].includes(screen),
    onClick: goBackScreen,
  })

  switch (screen) {
    case "location":
      return <LocationStep pickup={pickup} addressLabel={addressLabel} geoMessage={geoMessage} onPick={(point) => applyPickup(point)} onRetryGeo={retryGeolocation} onBack={() => setScreen("home")} onNext={confirmLocationAndQuote} />
    case "destination":
      return <DestinationStep pickup={pickup} destination={destinationPoint} value={destination} onPick={setDestinationFromMap} onChange={setDestination} onBack={() => setScreen("location")} onNext={() => setScreen("price")} />
    case "details":
      return <DetailsStep pickup={pickup} destination={destinationPoint} value={vehicleState} onChange={setVehicleState} onBack={() => setScreen("destination")} onNext={() => setScreen("price")} />
    case "price":
      return <PriceStep serviceLabel={serviceLabel} breakdown={breakdown} pickup={pickup} destination={destinationPoint} etaMinutes={quoteEtaMinutes} loading={loading} onConfirm={submitOrder} onBack={() => setScreen("location")} />
    case "searching":
      return <SearchingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onCancel={cancelOrder} onRetryDispatch={retryOrderDispatch} />
    case "assigned":
      return <AssignedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onTrack={startTracking} onCancel={cancelOrder} />
    case "tracking":
      return <TrackingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} progress={trackingProgress} onCancel={cancelOrder} />
    case "arrived":
      return <ArrivedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onComplete={completeOrder} onCancel={cancelOrder} />
    case "in_progress":
      return <InProgressStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onCancel={cancelOrder} />
    case "completed":
      return <FinalStep orderId={orderId} status="completed" onRestart={restart} />
    case "cancelled":
      return <FinalStep orderId={orderId} status="cancelled" onRestart={restart} />
    case "error":
      return <ErrorStep onRetry={() => setScreen("price")} />
    case "home":
    default:
      return <HomeStep pickup={pickup} locationLabel={addressLabel || geoMessage} providers={nearbyProviders} providersLoading={providersLoading} customerProfile={customerProfile} customerVerificationSaving={customerVerificationSaving} customerVerificationError={customerVerificationError} customerToken={customerAuthToken} isTelegram={isTelegram} onProfileChange={(patch) => setCustomerProfile((profile) => ({ ...profile, ...patch }))} onVerifyCustomer={verifyCustomerProfile} onProfileVerified={(saved) => setCustomerProfile((profile) => ({ ...profile, ...saved }))} onRetryGeo={retryGeolocation} onSelect={(service) => { if (!isCustomerReadyForOrder(customerProfile)) return; setSelectedService(service); const resolved = resolveServiceDestination(service, pickup); setDestination(resolved.destination); setDestinationPoint(resolved.destinationPoint); setScreen("location") }} />
  }
}

function ProviderFlow({ providerToken, providerRegistered = false }: { providerToken?: string; providerRegistered?: boolean }) {
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
  const [loginView, setLoginView] = useState<"login" | "register">(() => (providerRegistered ? "login" : "register"))
  const [step, setStep] = useState<"register" | "duty" | "offer" | "navigation" | "arrived" | "completed">(() => {
    if (typeof window === "undefined") return "register"
    if (providerRegistered || window.localStorage.getItem(`pomichPartnerRegistered:${getActiveProviderId()}`)) return "duty"
    return "register"
  })
  const [onDuty, setOnDuty] = useState(false)
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [registrationSaving, setRegistrationSaving] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | undefined>()
  const [incomingOffers, setIncomingOffers] = useState<DispatchOffer[]>([])
  const [mapProviders, setMapProviders] = useState<ProviderAvailability[]>([])
  const [mapRequestPins, setMapRequestPins] = useState<MapRequestPin[]>([])
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
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
  })
  const [registrationForm, setRegistrationForm] = useState<PartnerRegistrationForm>({
    name: provider.name,
    phone: provider.phone,
    telegram: provider.telegram,
    vehicle: provider.vehicle,
    plate: provider.plate,
    city: "Ужгород",
    specialties: [],
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
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

    if (isAuthSessionToken(providerToken)) {
      if (typeof window !== "undefined") window.sessionStorage.setItem(providerSessionStorageKey, providerToken)
      setProviderAccessToken(providerToken)
      setAuthError(undefined)
      return
    }

    let cancelled = false
    const customerId = typeof window !== "undefined" ? window.sessionStorage.getItem("pomichCustomerId") : null
    const customerToken = customerId ? readStoredAuthSession(authSessionStorageKey("customer", customerId), "customer", customerId) : undefined

    const openSession = async () => {
      if (providerToken) {
        return createProviderSession(providerId, providerToken)
      }
      if (customerId && customerToken) {
        return createSelfProviderSession(customerId, customerToken)
      }
      throw new Error("provider_auth_missing")
    }

    openSession()
      .then((session) => {
        if (cancelled) return
        storeAuthSession(providerSessionStorageKey, session)
        setProviderAccessToken(session.accessToken)
        setAuthError(undefined)
      })
      .catch(() => {
        if (!cancelled && providerRegistered) {
          setAuthError("Партнерська сесія не відкрита. Увійдіть з логіном і паролем або зверніться до диспетчера.")
        }
      })

    return () => {
      cancelled = true
    }
  }, [providerAuthToken, providerId, providerRegistered, providerSessionStorageKey, providerToken])

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
          city: (currentProvider as { city?: string }).city || form.city || "Ужгород",
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
        setStep(currentProvider.registeredAt ? "duty" : "register")
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

  useEffect(() => {
    if (!onDuty || (step !== "duty" && step !== "offer")) return
    let cancelled = false

    const refreshMapData = () => {
      getMapProviders()
        .then((items) => {
          if (!cancelled) setMapProviders(Array.isArray(items) ? items : [])
        })
        .catch(() => {
          if (!cancelled) setMapProviders([])
        })

      getNearbyMapOrders(providerLocation.lat, providerLocation.lng, providerProfile.serviceRadiusKm ?? 20)
        .then((orders) => {
          if (cancelled) return
          const offerByOrder = new Map(incomingOffers.map((offer) => [offer.orderId, offer]))
          const pins: MapRequestPin[] = (orders ?? []).map((order) => {
            const offer = offerByOrder.get(order.id)
            return {
              ...order,
              offerId: offer?.id,
              etaMinutes: offer?.etaMinutes ?? order.etaMinutes,
              distanceKm: offer?.distanceKm ?? order.distanceKm,
            }
          })
          setMapRequestPins(pins)
        })
        .catch(() => {
          if (!cancelled) setMapRequestPins([])
        })
    }

    refreshMapData()
    const interval = window.setInterval(refreshMapData, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [onDuty, providerLocation.lat, providerLocation.lng, providerProfile.serviceRadiusKm, step, incomingOffers])

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

  const acceptFromMapPin = (pin: MapRequestPin) => {
    const offer = incomingOffers.find((item) => item.id === pin.offerId || item.orderId === pin.id)
    if (offer) {
      acceptOffer(offer)
      return
    }
    setOfferError("Запрошення ще не надійшло. Очікуйте dispatch або оновіть карту.")
  }

  const contactFromMapPin = (pin: MapRequestPin) => {
    if (pin.phone) {
      window.location.href = `tel:${pin.phone}`
      return
    }
    setOfferError("Телефон клієнта буде доступний після прийняття заявки.")
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

  const ensureProviderSession = async () => {
    if (providerAuthToken) return providerAuthToken

    let customerId = typeof window !== "undefined" ? window.sessionStorage.getItem("pomichCustomerId") : null
    let customerToken = customerId ? readStoredAuthSession(authSessionStorageKey("customer", customerId), "customer", customerId) : undefined

    if (!customerToken) {
      const session = await createGuestCustomerSession(customerId && customerId !== "customer-web" ? customerId : undefined)
      customerId = session.customerId ?? session.subjectId ?? customerId ?? "customer-web"
      if (customerId && session.accessToken) {
        storeAuthSession(authSessionStorageKey("customer", customerId), session)
        if (typeof window !== "undefined") window.sessionStorage.setItem("pomichCustomerId", customerId)
        customerToken = session.accessToken
      }
    }

    if (!customerId || !customerToken) throw new Error("customer_session_missing")

    const linkedId = resolveProviderIdForCustomer(customerId)
    if (linkedId) storeLinkedProviderId(linkedId)

    await setUserPreferredRole(customerId, "provider", customerToken).catch(() => undefined)

    const session = providerToken
      ? await createProviderSession(providerId, providerToken)
      : await createSelfProviderSession(customerId, customerToken)

    storeAuthSession(providerSessionStorageKey, session)
    setProviderAccessToken(session.accessToken)
    setAuthError(undefined)
    return session.accessToken
  }

  const saveRegistration = async () => {
    const phoneValidation = validateUkraineMobilePhone(registrationForm.phone)
    if (!registrationForm.name.trim() || !phoneValidation.valid || !registrationForm.vehicle.trim() || !(registrationForm.city || "").trim() || registrationForm.specialties.length === 0) {
      setRegistrationError(phoneValidation.valid ? "Заповніть профіль і оберіть хоча б одну послугу." : (phoneValidation.error || "Введіть коректний номер телефону"))
      return
    }

    setRegistrationSaving(true)
    setRegistrationError(undefined)
    try {
      const token = providerAuthToken ?? await ensureProviderSession()
      const updated = await updateProviderProfile(providerId, {
        ...registrationForm,
        phone: phoneValidation.e164,
        location: providerLocation,
      }, token)
      const documentsReady = Boolean(registrationForm.identityDocumentRef.trim() && registrationForm.driverLicenseRef.trim() && registrationForm.vehicleRegistrationRef.trim() && registrationForm.serviceProofRef.trim() && registrationForm.selfieRef.trim())
      const trustedProfile = documentsReady
        ? await submitProviderVerification(providerId, {
          identityDocumentRef: registrationForm.identityDocumentRef,
          driverLicenseRef: registrationForm.driverLicenseRef,
          vehicleRegistrationRef: registrationForm.vehicleRegistrationRef,
          serviceProofRef: registrationForm.serviceProofRef,
          selfieRef: registrationForm.selfieRef,
        }, token)
        : updated
      setProviderProfile((profile) => ({ ...profile, ...trustedProfile, specialties: toServiceKeys(trustedProfile.specialties) }))
      if (typeof window !== "undefined") window.localStorage.setItem(`pomichPartnerRegistered:${providerId}`, "1")
      setStep("duty")
      setLoginView("login")
    } catch {
      setRegistrationError("Не вдалося зберегти профіль партнера. Перевірте підключення та спробуйте ще раз.")
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
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не вдалося увійти в акаунт партнера.")
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
    if (loginView === "register") {
      return (
        <ProviderRegistrationStep
          form={registrationForm}
          saving={registrationSaving}
          error={registrationError}
          onChange={updateRegistrationForm}
          onToggleSpecialty={toggleRegistrationSpecialty}
          onSubmit={saveRegistration}
          onLogin={() => {
            setRegistrationError(undefined)
            setLoginView("login")
          }}
        />
      )
    }

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
        onRegister={() => {
          setAuthError(undefined)
          setLoginView("register")
        }}
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
      <RideScreen
        pickup={providerLocation}
        providers={[providerPresence, ...mapProviders]}
        requestPins={mapRequestPins}
        mapSubtitle={onDuty ? `На лінії · ${mapRequestPins.length} заявок поруч` : "Ужгород · партнер"}
        showAllProviders
        onAcceptRequest={acceptFromMapPin}
        onContactRequest={contactFromMapPin}
      >
        <SheetHeading title="Партнер POMICH" subtitle={onDuty ? "Ви на лінії — заявки на карті" : "Вийдіть на лінію, щоб бачити заявки"} />
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {authError ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{authError}</div> : null}
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
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800 }}>Заявки на карті</div>
                <div style={{ color: DARK, fontWeight: 950, marginTop: 4 }}>{mapRequestPins.length}</div>
              </div>
              <div style={{ background: BG, borderRadius: 14, padding: 12 }}>
                <div style={{ color: "#6B7280", fontSize: 12, fontWeight: 800 }}>Сервісів Ужгорода</div>
                <div style={{ color: DARK, fontWeight: 950, marginTop: 4 }}>{mapProviders.filter((item) => item.providerKind === "directory").length}</div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {onDuty ? (
              <>
                <PrimaryButton label={offerSaving ? "Приймаємо…" : activeOffer ? "Відкрити заявку" : "Оновити карту"} onClick={() => activeOffer ? setStep("offer") : undefined} disabled={offerSaving} />
                <SecondaryButton label="Піти з лінії" onClick={() => setDuty(false)} disabled={!providerAuthToken} />
              </>
            ) : (
              <PrimaryButton label={!providerCanGoOnline ? "Очікує перевірки" : presenceSaving ? "Оновлюємо статус…" : "Вийти на лінію"} onClick={() => setDuty(true)} disabled={!providerAuthToken || !providerCanGoOnline || presenceSaving} />
            )}
            <SecondaryButton label="Редагувати профіль" onClick={() => setStep("register")} />
          </div>
          {offerError ? <div style={{ background: "#FFF7ED", color: "#B45309", borderRadius: 14, padding: 12, fontWeight: 850 }}>{offerError}</div> : null}
        </div>
      </RideScreen>
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
    <RideScreen
      pickup={mapRequestPins[0]?.customerCoordinates ?? providerLocation}
      providers={[providerPresence, ...mapProviders]}
      requestPins={mapRequestPins}
      mapSubtitle="Заявки поруч на карті"
      showAllProviders
      onAcceptRequest={acceptFromMapPin}
      onContactRequest={contactFromMapPin}
    >
      <button onClick={() => setStep("duty")} style={{ border: "none", background: "#F3F4F6", color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад до карти</button>
      <SheetHeading title="Заявки на карті" subtitle={`${mapRequestPins.length} активних · натисніть маркер`} />
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {mapRequestPins.length === 0 ? (
          <div style={{ background: BG, borderRadius: 14, padding: 12, fontWeight: 800, color: "#6B7280" }}>Поки немає заявок у вашому радіусі.</div>
        ) : (
          mapRequestPins.map((pin) => (
            <div key={pin.offerId ?? pin.id} style={{ background: "#fff", borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
              <div style={{ fontWeight: 950, color: DARK }}>{getServiceEmoji(pin.service)} {getProviderCapabilityLabel(pin.service)}</div>
              <div style={{ color: "#6B7280", fontWeight: 700, marginTop: 4, fontSize: 13 }}>{pin.customerLocation ?? "Поруч"} · {pin.distanceKm?.toFixed(1) ?? "?"} км</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                {pin.offerId ? <PrimaryButton label="Прийняти заявку" onClick={() => acceptFromMapPin(pin)} disabled={offerSaving} /> : null}
                <SecondaryButton label="Зв'язатися" onClick={() => contactFromMapPin(pin)} />
              </div>
            </div>
          ))
        )}
        {offerError ? <div style={{ background: "#FFF7ED", color: "#B45309", borderRadius: 14, padding: 12, fontWeight: 850 }}>{offerError}</div> : null}
      </div>
    </RideScreen>
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

export default function CustomerApp() {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const adminToken = useMemo(() => getStoredQueryToken("adminToken", "pomichAdminToken"), [])
  const providerToken = useMemo(() => getStoredQueryToken("providerToken", "pomichProviderToken"), [])
  const initialRole = useMemo<Role | null>(() => {
    if (typeof window === "undefined") return null
    const queryRole = new URLSearchParams(window.location.search).get("role")
    if (queryRole === "customer" || queryRole === "provider") return queryRole
    if (queryRole === "admin") return "admin"
    const entryRole = resolveEntryRole()
    if (entryRole) return entryRole
    return null
  }, [])
  const [role, setRole] = useState<Role | null>(initialRole)
  const [account, setAccount] = useState<UserAccountStatus | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (initialRole === "customer" || initialRole === "provider") return true
    if (telegramContext.isTelegram && initialRole !== "admin" && !providerToken) return true
    return false
  })
  const [pendingRole, setPendingRole] = useState<Role | null>(initialRole === "customer" || initialRole === "provider" ? initialRole : null)
  const [startAtRoleSelect, setStartAtRoleSelect] = useState(false)
  const [loginMode, setLoginMode] = useState(() => {
    if (telegramContext.isTelegram && initialRole !== "admin" && !providerToken) return true
    return false
  })
  const [showLanding, setShowLanding] = useState(false)
  const [showCabinet, setShowCabinet] = useState(false)
  const [forceRolePicker, setForceRolePicker] = useState(false)
  const [rolePickerKey, setRolePickerKey] = useState(0)
  const compact = telegramContext.isTelegram || isMobile
  const skipOnboarding = initialRole === "admin" || Boolean(providerToken)

  const handleRoleChange = (nextRole: Role | null) => {
    setRole(nextRole)
    setShowCabinet(false)
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

  const beginOnboarding = useCallback((nextRole: Role | null, openRolePicker = false, isLogin = false) => {
    if (skipOnboarding && nextRole) {
      handleRoleChange(nextRole)
      return
    }
    setPendingRole(nextRole)
    setStartAtRoleSelect(openRolePicker)
    setLoginMode(isLogin)
    setShowOnboarding(true)
    setShowLanding(false)
  }, [skipOnboarding])

  const handleSwitchRole = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem("pomichProviderToken")
      window.sessionStorage.removeItem("pomichAdminToken")
      const url = new URL(window.location.href)
      url.searchParams.delete("role")
      url.searchParams.delete("providerToken")
      url.searchParams.delete("adminToken")
      window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`)
    }
    setForceRolePicker(true)
    setRolePickerKey((value) => value + 1)
    setPendingRole(null)
    setStartAtRoleSelect(true)
    setShowOnboarding(true)
    setShowCabinet(false)
    setShowLanding(false)
    setRole(null)
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    if (isHiddenAdminHash()) {
      setRole("admin")
      setShowLanding(false)
      setShowOnboarding(false)
      clearHiddenAdminHash()
    }
  }, [])

  useEffect(() => {
    if (initialRole === null) setRole(null)
  }, [initialRole])

  useEffect(() => {
    if (providerToken) {
      setRole("provider")
      setShowOnboarding(false)
      setShowLanding(false)
      return
    }
    if (adminToken) {
      setRole("admin")
      setShowOnboarding(false)
      setShowLanding(false)
    }
  }, [adminToken, providerToken])

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

  if ((!skipOnboarding || forceRolePicker) && showOnboarding) {
    return (
      <OnboardingGate
        key={forceRolePicker ? `role-picker-${rolePickerKey}` : "onboarding"}
        skip={false}
        startAtRoleSelect={startAtRoleSelect || forceRolePicker}
        loginMode={loginMode}
        initialRole={pendingRole}
        onShowLanding={() => {
          setForceRolePicker(false)
          setShowOnboarding(false)
          setStartAtRoleSelect(false)
          setLoginMode(false)
          setPendingRole(null)
          setShowLanding(true)
        }}
        onReady={({ role: readyRole, account: readyAccount }) => {
          setAccount(readyAccount)
          if (readyAccount.linkedProviderId) storeLinkedProviderId(readyAccount.linkedProviderId)
          if (readyAccount.profile && typeof window !== "undefined") {
            window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(readyAccount.profile))
          }
          setForceRolePicker(false)
          setShowOnboarding(false)
          setStartAtRoleSelect(false)
          setLoginMode(false)
          setPendingRole(null)
          handleRoleChange(readyRole)
        }}
      />
    )
  }

  if (showCabinet && account?.profile && role === "customer") {
    const cabinetCustomerId = account.customerId
    const cabinetCustomerToken =
      typeof window !== "undefined"
        ? readStoredAuthSession(authSessionStorageKey("customer", cabinetCustomerId), "customer", cabinetCustomerId)
        : undefined
    return (
      <ClientCabinet
        profile={account.profile}
        customerId={cabinetCustomerId}
        customerToken={cabinetCustomerToken}
        currentRole="customer"
        onBack={() => setShowCabinet(false)}
        onStartOrder={() => setShowCabinet(false)}
        onSwitchRole={handleSwitchRole}
        onProfileUpdate={(nextProfile) => {
          setAccount((prev) => (prev ? { ...prev, profile: nextProfile } : prev))
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(nextProfile))
          }
        }}
      />
    )
  }

  if (showCabinet && role === "provider") {
    return (
      <ProviderCabinet
        profile={{ id: getActiveProviderId(), name: "Партнер POMICH", status: "offline" }}
        currentRole="provider"
        isOnline={typeof window !== "undefined" && window.localStorage.getItem("pomichProviderOnline") === "1"}
        onBack={() => setShowCabinet(false)}
        onGoOnline={() => {
          if (typeof window !== "undefined") window.localStorage.setItem("pomichProviderOnline", "1")
          setShowCabinet(false)
          handleRoleChange("provider")
        }}
        onGoOffline={() => {
          if (typeof window !== "undefined") window.localStorage.removeItem("pomichProviderOnline")
        }}
        onSwitchRole={handleSwitchRole}
      />
    )
  }

  if (role === "admin") {
    return <AdminFlow adminToken={adminToken} />
  }

  return (
    role === null || showLanding ? (
      <LandingPage
        onSelect={(nextRole) => beginOnboarding(nextRole, false, false)}
        onRegister={() => beginOnboarding(null, true, false)}
        onLogin={() => beginOnboarding(null, false, true)}
        onHiddenAdmin={() => {
          setRole("admin")
          setShowLanding(false)
          setShowOnboarding(false)
        }}
      />
    ) : (
      <AppShell compact={compact} role={role} onRoleChange={handleRoleChange} onOpenCabinet={() => setShowCabinet(true)} onSwitchRole={handleSwitchRole}>
        {role === "provider" ? <ProviderFlow providerToken={providerToken} providerRegistered={account?.providerRegistered ?? false} /> : <CustomerFlow />}
      </AppShell>
    )
  )
}
