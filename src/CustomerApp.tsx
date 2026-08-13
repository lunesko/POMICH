import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { acceptProviderOffer, cancelOrder as cancelOrderRequest, confirmOrderPrice, createGuestCustomerSession, createOrder, createProviderAccountSession, createProviderSession, createSelfProviderSession, createTelegramCustomerSession, declineProviderOffer, getMapProviders, getNearbyMapOrders, getOrder, getProviderOffers, getProviders, getTelegramSession, getUserAccount, messageFromFetchError, retryDispatch, setUserPreferredRole, submitOrderReview, updateCustomerProfile, updateProviderOrderStatus, updateProviderPresence, updateProviderProfile, ApiRequestError, type AuthSession, type CustomerProfile, type DispatchOffer, type MapRequestPin, type OrderResponse, type ProviderAvailability, type UserAccountStatus, type VerificationStatus } from "./api/client"
import RouteMap from "./components/map/RouteMap"
import { RideScreen } from "./components/layout/RideScreen"
import { PomichMapBackground, useSuppressMapAtmosphere } from "./components/layout/PomichMapShell"
import {
  calculateDistanceKm,
  calculatePrice,
  ON_SITE_DESTINATION_LABEL,
  sanitizeLocation,
  serviceRequiresDestination,
  validateCustomerOrderInput,
  type CustomerOrderInput,
  type ServiceKey,
} from "./lib/pomichDomain"
import { getTelegramContext, resolveEntryRole } from "./telegram"
import { getProfileChecklist, customerProfileStatusLabel, customerProfileStatusTone, DEFAULT_CUSTOMER_NAME, isCustomerProfileComplete, isCustomerReadyForOrder, isCustomerVerified, mergeCustomerProfiles, profileChecklistItemStatus, profileChecklistSummary } from "./lib/customerProfile"
import { composePartnerVehicle, emptyPartnerRegistrationForm, hydratePartnerVehicleFromProfile, isProviderPhoneVerified, nearbyProvidersFor, partnerVehicleSelectionIsComplete, providerPoint, resolvePartnerVehicleMake } from "./lib/constants"
import { formatLocalPhoneDisplay, nationalDigitsFromPhone, phoneInputValueFromStored, validateUkraineMobilePhone } from "./lib/ukrainePhone"
import { isValidUkrainePlate, validateUkrainePlate } from "./lib/ukrainePlate"
import { validatePersonName } from "./lib/personName"
import { DEFAULT_SERVICE_CITY, normalizeServiceCity, validateServiceCity } from "./lib/ukraineCities"
import { PhoneInput } from "./components/ui/PhoneInput"
import { UkrainePlateInput } from "./components/ui/UkrainePlateInput"
import { OtpVerificationPanel } from "./components/ui/OtpVerificationPanel"
import { CitySelect } from "./components/ui/CitySelect"
import { FieldError } from "./components/ui/FieldError"
import { isReturningClient, mergeAccountProfile, readBootstrapProfile, storeLinkedProviderId, resolveProviderIdForCustomer } from "./lib/userAccount"
import { mediaQueries } from "./lib/breakpoints"
import { useMediaQuery } from "./hooks/useMediaQuery"
import { useTelegramMainButton, useTelegramBackButton, useTelegramUx } from "./hooks/useTelegramUx"
import OnboardingGate from "./components/onboarding/OnboardingGate"
import ClientCabinet from "./components/cabinet/ClientCabinet"
import ProviderCabinet from "./components/cabinet/ProviderCabinet"
import AdminFlow from "./components/admin/AdminFlow"
import FormContainer, { FormFooterBar, FormHeader } from "./components/layout/FormContainer"
import { AccountLoginStep } from "./components/views/AccountLoginStep"
import { ProviderRegistrationStep } from "./components/views/ProviderRegistrationStep"
import { ServiceRadiusField } from "./components/ui/ServiceRadiusField"
import { PartnerVehicleFields } from "./components/provider/PartnerVehicleFields"
import { ThemeToggle } from "./components/ui/ThemeToggle"
import { usePomichTheme } from "./context/PomichThemeProvider"
import { type PomichThemeColors, type PomichThemeMode } from "./lib/theme"
import { applyHiddenAdminEntry, isAdminEntryLocation, isHiddenAdminHash } from "./lib/adminAccess"
import {
  clearAllAuthStorage,
  clearProviderAuthStorage,
  clearExplicitLogout,
  dismissSessionMismatchNotice,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  markExplicitLogout,
  purgeStaleCustomerSessions,
  readPersistedCustomerId,
  readAuthSessionSubject,
  resolveSessionMismatchWarning,
} from "./lib/auth"
import { clearActiveOrder, enrichProfileWithTelegram, persistActiveOrder, readActiveOrder, readBootstrapProfileForCustomer, resolveCustomerAuthSession } from "./lib/customerSession"
import { reverseGeocodeAddress } from "./lib/reverseGeocode"
import { MAP_GEO_DEBOUNCE_MS, MAP_RECENTER_THRESHOLD_M, requestCurrentPosition, shouldRecenterMap } from "./lib/mapGeo"
import { syncProfileCityFromGeo } from "./lib/syncProfileCityFromGeo"
import { OrderErrorStep, OrderFinalStep } from "./components/customer/OrderTerminalStep"
import { DutyStatusToggle, PresenceToast, presenceErrorMessage } from "./components/ui/DutyStatusToggle"
import { OrderRequestSheet } from "./components/provider/OrderRequestSheet"
import { filterActiveOffers, isOfferActive, offerSecondsLeft, pinFromOffer } from "./lib/dispatchOffer"

type Role = "customer" | "provider" | "admin"
type Screen =
  | "profile"
  | "home"
  | "location"
  | "destination"
  | "details"
  | "review"
  | "searching"
  | "accepted"
  | "assigned"
  | "tracking"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "error"
type OrderStatus = "draft" | "searching" | "accepted" | "price_confirmed" | "assigned" | "en_route" | "arrived" | "in_progress" | "completed" | "cancelled"
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
  vehicleMake: string
  vehicleMakeOther: string
  vehicleModel: string
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

const BRAND = "var(--pomich-brand)"
const DARK = "var(--pomich-text)"
const BG = "var(--pomich-bg)"
const BORDER = "var(--pomich-border)"
const MUTED = "var(--pomich-muted)"
const SUBTLE = "var(--pomich-subtle)"
const CARD = "var(--pomich-card-bg)"
const SURFACE_TONE = "var(--pomich-service-tone-default)"
const SELECTED = "var(--pomich-selected-bg)"
const GHOST = "var(--pomich-ghost-bg)"
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
  searching: "Очікуємо партнера",
  accepted: "Партнер прийняв",
  price_confirmed: "Ціна підтверджена",
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
  const customerId =
    window.sessionStorage.getItem("pomichCustomerId") ||
    window.localStorage.getItem("pomichCustomerId")
  const derived = customerId ? resolveProviderIdForCustomer(customerId) : ""
  const linked = window.sessionStorage.getItem("pomichLinkedProviderId") || ""
  // Drop stale seed link (provider-oleksandr) when the signed-in customer maps elsewhere.
  if (derived && linked && linked !== derived && linked === provider.id) {
    storeLinkedProviderId(derived)
    return derived
  }
  if (linked) return linked
  if (derived) return derived
  return provider.id
}

function resolveSessionProviderId(session: { providerId?: string; subjectId?: string }, fallback: string) {
  return String(session.providerId || session.subjectId || fallback).trim() || fallback
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

function distanceToProvider(pickup: Point, item: ProviderAvailability) {
  const point = providerPoint(item)
  return point ? calculateDistanceKm(pickup, point) : Number.POSITIVE_INFINITY
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
  if (status === "verified") return { background: SELECTED, color: BRAND, border: "rgba(22, 163, 106, 0.28)" }
  if (status === "pending") return { background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", border: "#FED7AA" }
  if (status === "rejected") return { background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", border: "#FECDD3" }
  return { background: GHOST, color: MUTED, border: BORDER }
}

function isVerified(status?: VerificationStatus) {
  return status === "verified"
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

const FLOW_STEP_LABELS = ["Оберіть проблему", "Де ви зараз?", "Куди / на місці", "Перевірте заявку"] as const

function StepBadge({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="pomich-step-badge">
      Крок {step} з 4 · {FLOW_STEP_LABELS[step - 1]}
    </div>
  )
}

function resolveServiceDestination(service: ServiceKey, pickup: Point): { destination: string; destinationPoint: Point } {
  if (serviceRequiresDestination(service)) {
    return { destination: "СТО «Авторемонт»", destinationPoint: DEFAULT_DESTINATION }
  }
  return { destination: ON_SITE_DESTINATION_LABEL, destinationPoint: pickup }
}

function resolveOrderDistanceKm(service: ServiceKey, pickup: Point, destinationPoint: Point): number {
  const raw = calculateDistanceKm(pickup, destinationPoint)
  return serviceRequiresDestination(service) ? raw : Math.max(0.5, raw)
}

function PrimaryButton({ label, onClick, loading = false, disabled = false }: { label: string; onClick?: () => void; loading?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`pomich-primary-btn${disabled || loading ? " is-disabled" : ""}`}
    >
      {loading ? "Створюємо заявку…" : label}
    </button>
  )
}

function SecondaryButton({ label, onClick, danger = false, disabled = false }: { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`pomich-flow-secondary-btn${danger ? " is-danger" : ""}`}
    >
      {label}
    </button>
  )
}

function StatusPill({ status }: { status: OrderStatus }) {
  const cancelled = status === "cancelled"
  return (
    <div className={`pomich-status-pill ${cancelled ? "pomich-status-pill--cancelled" : "pomich-status-pill--active"}`}>
      <span className="pomich-status-pill__dot" />
      {orderStatusLabels[status]}
    </div>
  )
}

function Timeline({ status }: { status: OrderStatus }) {
  const steps: Array<{ status: OrderStatus; label: string }> = [
    { status: "searching", label: "Пошук" },
    { status: "accepted", label: "Ціна" },
    { status: "price_confirmed", label: "Підтверджено" },
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
            <div style={{ marginTop: 5, fontSize: 10, color: active ? DARK : SUBTLE, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{step.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function ProviderCard({
  orderId,
  eta,
  assignedProvider,
  fallbackName,
  allowDemoFallback = true,
}: {
  orderId?: string
  eta?: number
  assignedProvider?: OrderResponse["assignedProvider"] | ProviderAvailability
  fallbackName?: string
  allowDemoFallback?: boolean
}) {
  const cardProvider = assignedProvider ?? (allowDemoFallback ? provider : undefined)
  if (!cardProvider) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
        <div style={{ fontWeight: 900, color: DARK }}>{fallbackName ?? "Партнер прийняв заявку"}</div>
        <div style={{ color: MUTED, fontWeight: 700, marginTop: 6, fontSize: 13 }}>Завантажуємо дані виконавця…</div>
      </div>
    )
  }
  const phone = cardProvider.phone ?? (allowDemoFallback ? provider.phone : undefined)
  const telegram = cardProvider.telegram ?? (allowDemoFallback ? provider.telegram : undefined)
  const rating = cardProvider.rating ?? (allowDemoFallback ? provider.rating : undefined)
  const distanceKm = "distanceKm" in cardProvider && typeof cardProvider.distanceKm === "number" ? cardProvider.distanceKm : undefined
  const verificationStatus = "verificationStatus" in cardProvider ? cardProvider.verificationStatus : "verified"
  const distanceLabel =
    typeof distanceKm === "number"
      ? distanceKm < 0.15
        ? "Поруч із вами"
        : `${distanceKm.toFixed(1)} км від вас`
      : null
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, boxShadow: "0 8px 22px rgba(0,0,0,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: SELECTED, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>🚛</div>
          <div>
            <div style={{ fontWeight: 900, color: DARK }}>{cardProvider.name ?? fallbackName ?? "Партнер"}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{[cardProvider.vehicle, cardProvider.plate].filter(Boolean).join(" · ") || "Дані авто уточнюються"}</div>
            <div style={{ marginTop: 6 }}><VerificationPill status={verificationStatus} /></div>
          </div>
        </div>
        {typeof rating === "number" ? <div style={{ textAlign: "right", fontWeight: 900, color: BRAND }}>★ {rating}</div> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: phone && telegram ? "1fr 1fr" : "1fr", gap: 10, marginTop: 12 }}>
        {phone ? <a href={`tel:${phone}`} style={{ textDecoration: "none" }}><SecondaryButton label="📞 Подзвонити" /></a> : null}
        {telegram ? <a href={`https://t.me/${telegram}${orderId ? `?start=order_${orderId}` : ""}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><SecondaryButton label="💬 Чат" /></a> : null}
      </div>
      {eta ? <div style={{ marginTop: 10, color: MUTED, fontSize: 13, fontWeight: 700 }}>Прибуття приблизно за {eta} хв</div> : null}
      {distanceLabel ? <div style={{ marginTop: 6, color: MUTED, fontSize: 13, fontWeight: 700 }}>{distanceLabel}</div> : null}
    </div>
  )
}

function AppShell({ children, compact, role, loggedInName, onRoleChange, onOpenCabinet, onSwitchRole, onLogout }: { children: React.ReactNode; compact: boolean; role: Role | null; loggedInName?: string; onRoleChange: (role: Role | null) => void; onOpenCabinet?: () => void; onSwitchRole?: () => void; onLogout?: () => void }) {
  const roleLabels: Record<Exclude<Role, null>, string> = { customer: "Клієнт", provider: "Партнер", admin: "Адмін" }

  if (compact) {
    return (
      <div className="pomich-tg-app flex flex-col">
        {role ? (
          <header className="pomich-tg-header flex shrink-0 items-center justify-between px-3 gap-2 w-full">
            <button type="button" onClick={() => onRoleChange(null)} className="pomich-app-header-menu-btn">← Меню</button>
            <div className={loggedInName ? "pomich-app-header-session" : "pomich-app-header-role-label"}>
              {loggedInName ? `Ви увійшли як: ${loggedInName}` : roleLabels[role]}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <ThemeToggle compact />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--compact">Кабінет</button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--compact">Роль</button>
              ) : null}
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-app-header-chip pomich-app-header-chip--compact pomich-app-header-chip--muted">Вийти</button>
              ) : null}
            </div>
          </header>
        ) : null}
        <div className="pomich-tg-main pomich-app-main min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    )
  }

  return (
    <div className="pomich-themed-shell min-h-dvh">
      {role ? (
        <header className="pomich-tg-header flex h-[62px] shrink-0 items-center justify-center px-6 w-full">
          <div className="flex w-full max-w-7xl items-center justify-between gap-4">
            <button type="button" onClick={() => onRoleChange(null)} className="pomich-app-header-brand text-xl">POMICH</button>
            {loggedInName ? (
              <span className="pomich-app-header-session hidden md:inline">Ви увійшли як: {loggedInName}</span>
            ) : null}
            <div className="flex items-center gap-2 overflow-x-auto">
              {!loggedInName ? (
                <>
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
                </>
              ) : (
                <span className="pomich-app-header-chip pomich-app-header-chip--regular is-active pointer-events-none">
                  {roleLabels[role]}
                </span>
              )}
              <ThemeToggle />
              {onOpenCabinet ? (
                <button type="button" onClick={onOpenCabinet} className="pomich-app-header-chip pomich-app-header-chip--regular">Кабінет</button>
              ) : null}
              {onSwitchRole ? (
                <button type="button" onClick={onSwitchRole} className="pomich-app-header-chip pomich-app-header-chip--regular">Змінити роль</button>
              ) : null}
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-app-header-chip pomich-app-header-chip--regular pomich-app-header-chip--muted">Вийти</button>
              ) : null}
            </div>
          </div>
        </header>
      ) : null}
      <div className="pomich-app-main min-h-0 flex-1">{children}</div>
    </div>
  )
}

function CustomerAppFallback({ message, onRetry, onLanding }: { message: string; onRetry?: () => void; onLanding?: () => void }) {
  return (
    <div className="pomich-app-fallback">
      <div className="pomich-app-fallback__card">
        <div className="pomich-app-fallback__title">{message}</div>
        <div className="pomich-app-fallback__actions">
          {onRetry ? (
            <button type="button" className="pomich-primary-btn" onClick={onRetry}>
              Спробувати ще
            </button>
          ) : null}
          {onLanding ? (
            <button type="button" className="pomich-ghost-btn" onClick={onLanding}>
              На головну
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ScreenLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="pomich-themed-shell pomich-screen-layout" style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: "100%", minHeight: "100%", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <div className="pomich-screen-layout__content" style={{ flex: 1, minWidth: 0, overflow: "auto", overflowX: "hidden" }}>{children}</div>
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


function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div className="pomich-sheet-heading__title">{title}</div>
      {subtitle ? <div className="pomich-sheet-heading__subtitle">{subtitle}</div> : null}
    </div>
  )
}

function LocationRow({ icon, title, subtitle, active = false }: { icon: string; title: string; subtitle: string; active?: boolean }) {
  return (
    <div className="pomich-location-row">
      <div className="pomich-location-row__icon" style={{ background: active ? SELECTED : GHOST }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="pomich-location-row__title">{title}</div>
        <div className="pomich-location-row__subtitle">{subtitle}</div>
      </div>
    </div>
  )
}

function SheetDivider() {
  return <div style={{ height: 1, background: BORDER, margin: "4px 0" }} />
}

function GeoRefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Оновити геолокацію"
      onClick={onClick}
      disabled={loading}
      style={{
        minHeight: 36,
        padding: "0 12px",
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: loading ? GHOST : CARD,
        color: loading ? SUBTLE : DARK,
        fontWeight: 900,
        fontSize: 12,
        cursor: loading ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{loading ? "…" : "↻"}</span>
      {loading ? "Оновлюємо…" : "Оновити"}
    </button>
  )
}

function CurrentLocationCard({
  locationLabel,
  geoLoading,
  geoError,
  onRefreshGeo,
  children,
}: {
  locationLabel: string
  geoLoading: boolean
  geoError?: string
  onRefreshGeo: () => void
  children?: ReactNode
}) {
  return (
    <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px 10px", background: SURFACE_TONE }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <LocationRow icon="●" title="Поточне місце" subtitle={geoLoading ? "Визначаємо адресу…" : locationLabel} active />
        </div>
        <GeoRefreshButton loading={geoLoading} onClick={onRefreshGeo} />
      </div>
      {geoError ? (
        <div style={{ background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
          {geoError}
        </div>
      ) : null}
      {children}
    </div>
  )
}

function AvailabilityPanel({ pickup, providers, loading }: { pickup: Point; providers: ProviderAvailability[]; loading: boolean }) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const nearest = nearby[0]

  return (
    <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 950, color: DARK }}>{loading ? "Перевіряємо партнерів" : nearby.length > 0 ? `${nearby.length} на лінії поруч` : "Партнерів поруч не видно"}</div>
          <div style={{ color: MUTED, fontWeight: 700, fontSize: 12, marginTop: 4 }}>{nearest ? `Найближчий: ${nearest.name} · ~${nearest.etaMinutes ?? Math.ceil(distanceToProvider(pickup, nearest) * 4)} хв` : "Можна створити заявку, диспетчер підключить найближчого вручну."}</div>
        </div>
        <div style={{ borderRadius: 999, padding: "7px 10px", background: nearby.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: nearby.length > 0 ? BRAND : "var(--pomich-warn-text)", fontSize: 12, fontWeight: 950 }}>
          {nearby.length > 0 ? "Live" : "Очікування"}
        </div>
      </div>
      {nearby.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {nearby.slice(0, 2).map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: BG, borderRadius: 14, padding: "10px 12px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: DARK, fontWeight: 900, fontSize: 13 }}>{item.name} · {item.vehicle ?? "Автодопомога"}</div>
                <div style={{ color: MUTED, fontSize: 12, fontWeight: 700, marginTop: 2 }}>{providerStatusLabel(item.status)} · {distanceToProvider(pickup, item).toFixed(1)} км</div>
                <div style={{ color: MUTED, fontSize: 11, fontWeight: 800, marginTop: 3 }}>{toServiceKeys(item.specialties).map(getProviderCapabilityLabel).join(" · ") || "Послуги уточнюються"}</div>
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
  const [draft, setDraft] = useState({
    name: profile.name || "",
    phone: phoneInputValueFromStored(profile.phone),
    email: profile.email || "",
  })

  useEffect(() => {
    setDraft((current) => {
      const next = {
        name: profile.name || "",
        phone: phoneInputValueFromStored(profile.phone),
        email: profile.email || "",
      }
      const currentPhoneValid = validateUkraineMobilePhone(current.phone).valid
      const nextPhoneValid = validateUkraineMobilePhone(next.phone).valid
      if (currentPhoneValid && !nextPhoneValid) next.phone = current.phone
      if (current.name.trim() && !next.name.trim()) next.name = current.name
      if (current.email.trim() && !next.email.trim()) next.email = current.email
      if (!currentPhoneValid && nextPhoneValid) next.phone = next.phone
      return next
    })
  }, [profile.id, profile.name, profile.phone, profile.email])

  const patchDraft = (patch: Partial<CustomerProfile>) => {
    setDraft((current) => ({ ...current, ...patch }))
    onChange(patch)
  }

  const checklist = getProfileChecklist({ ...profile, ...draft })
  const initials = (draft.name || profile.name || "POMICH").trim().slice(0, 1).toUpperCase()
  const phoneDisplay = draft.phone?.trim()
    ? `+380 ${formatLocalPhoneDisplay(nationalDigitsFromPhone(draft.phone))}`
    : profile.phone?.trim()
      ? `+380 ${formatLocalPhoneDisplay(nationalDigitsFromPhone(profile.phone))}`
      : "Не вказано"
  const nameDisplay = draft.name?.trim() || profile.name?.trim() || "Клієнт POMICH"
  const profileTone = customerProfileStatusTone({ ...profile, ...draft })
  const draftComplete = isCustomerProfileComplete({ ...profile, ...draft })
  const profileVerified = isCustomerVerified({ ...profile, ...draft })

  return (
    <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, minWidth: 0, alignItems: "flex-start" }}>
        <div style={{ width: 48, height: 48, borderRadius: 999, background: "linear-gradient(135deg, #16A36A, #2F80ED)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 950, fontSize: 20, flex: "0 0 auto" }}>{initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: DARK, fontWeight: 950, fontSize: 15 }}>Ваш профіль</div>
          <div style={{ color: MUTED, fontSize: 12, fontWeight: 800, marginTop: 3 }}>{nameDisplay} · {phoneDisplay}</div>
          {!profileVerified ? (
            <div style={{ marginTop: 7 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: profileTone.background, border: `1px solid ${profileTone.border}`, color: profileTone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: profileTone.color }} />
                {customerProfileStatusLabel({ ...profile, ...draft })}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Ім'я *</span>
          <input value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} placeholder="Ваше ім'я" className="pomich-form-input" style={{ color: DARK }} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Телефон *</span>
          <PhoneInput value={draft.phone} onChange={(phone) => patchDraft({ phone })} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Email</span>
          <input value={draft.email} onChange={(event) => patchDraft({ email: event.target.value })} inputMode="email" placeholder="email@example.com" className="pomich-form-input" style={{ color: DARK }} />
        </label>
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 12, background: SURFACE_TONE }}>
        <div style={{ fontWeight: 950, fontSize: 13, color: DARK, marginBottom: 8 }}>{profileChecklistSummary({ ...profile, ...draft })}</div>
        <div style={{ display: "grid", gap: 6 }}>
          {checklist.map((item) => (
            <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, fontWeight: 800 }}>
              <span style={{ color: "var(--pomich-label)" }}>{item.label}{item.required ? " *" : ""}</span>
              <span style={{ color: item.filled ? BRAND : SUBTLE }}>{profileChecklistItemStatus(item)}</span>
            </div>
          ))}
        </div>
      </div>

      <button onClick={onVerify} disabled={saving || !draftComplete} style={{ minHeight: 42, borderRadius: 14, border: "none", background: saving || !draftComplete ? GHOST : BRAND, color: saving || !draftComplete ? MUTED : "#fff", fontFamily: "inherit", fontWeight: 950, cursor: saving || !draftComplete ? "not-allowed" : "pointer", display: isTelegram ? "none" : undefined }}>
        {saving ? "Зберігаємо…" : "Зберегти профіль"}
      </button>
      {!isCustomerVerified(profile) && draftComplete ? (
        <OtpVerificationPanel
          profile={{ ...profile, ...draft }}
          customerToken={customerToken}
          isTelegram={isTelegram}
          phone={draft.phone}
          email={draft.email}
          compact
          onVerified={onVerified}
        />
      ) : null}
      {error ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 12, padding: 10, fontSize: 12, fontWeight: 850 }}>{error}</div> : null}
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
  geoLoading,
  geoError,
  recenterTrigger,
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
  geoLoading: boolean
  geoError?: string
  recenterTrigger: number
  onProfileChange: (patch: Partial<CustomerProfile>) => void
  onVerifyCustomer: () => void
  onProfileVerified: (profile: CustomerProfile) => void
  onRetryGeo: () => void
  onSelect: (service: ServiceKey) => void
}) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const profileReady = isCustomerReadyForOrder(customerProfile)

  const handleSelect = (service: ServiceKey) => {
    if (!profileReady) return
    onSelect(service)
  }

  return (
    <RideScreen pickup={pickup} providers={providers} mapSubtitle={`${locationLabel} · Ужгород`} expandedSheet={!profileReady} recenterTrigger={recenterTrigger} onRetryGeo={onRetryGeo} geoLoading={geoLoading} geoError={geoError}>
      <div data-sheet-full>
      <StepBadge step={1} />
      <SheetHeading title="Потрібна допомога на дорозі?" subtitle="Спочатку заповніть профіль, потім оберіть проблему." />

      <CurrentLocationCard locationLabel={locationLabel} geoLoading={geoLoading} geoError={geoError} onRefreshGeo={onRetryGeo}>
        <SheetDivider />
        <div className="pomich-location-hint" aria-disabled="true">
          <LocationRow icon="🏁" title="Куди везти або де ремонтувати" subtitle="Уточнимо після вибору послуги" />
        </div>
      </CurrentLocationCard>

      <div style={{ marginTop: 14 }}>
        {!profileReady ? (
          isCustomerProfileComplete(customerProfile) ? (
            <OtpVerificationPanel
              profile={customerProfile}
              customerToken={customerToken}
              isTelegram={isTelegram}
              compact
              onVerified={onProfileVerified}
            />
          ) : (
            <CustomerTrustPanel profile={customerProfile} saving={customerVerificationSaving} error={customerVerificationError} customerToken={customerToken} isTelegram={isTelegram} onChange={onProfileChange} onVerify={onVerifyCustomer} onVerified={onProfileVerified} />
          )
        ) : null}
      </div>

      {!profileReady ? (
        <div style={{ marginTop: 12, background: "var(--pomich-info-bg)", color: "var(--pomich-info-text)", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800 }}>
          {isCustomerProfileComplete(customerProfile)
            ? "Підтвердіть профіль кодом з Telegram або email, щоб викликати допомогу."
            : "Заповніть ім'я та телефон, щоб викликати допомогу."}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <AvailabilityPanel pickup={pickup} providers={providers} loading={providersLoading} />
      </div>

      <div className="pomich-sheet-section-head">
        <div className="pomich-sheet-section-title">Що сталося?</div>
        <div className="pomich-sheet-badge" style={{ background: nearby.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: nearby.length > 0 ? BRAND : "var(--pomich-warn-text)" }}>
          {nearby.length > 0 ? `${nearby.length} поруч` : "диспетчер"}
        </div>
      </div>

      <div className="pomich-flow-stack">
        {services.map((service) => (
          <button key={service.key} type="button" onClick={() => handleSelect(service.key as ServiceKey)} disabled={!profileReady} className="pomich-service-row" style={{ background: profileReady ? CARD : GHOST, opacity: profileReady ? 1 : 0.7 }}>
            <span className="pomich-service-row__icon" style={{ background: service.tone }}>{service.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span className="pomich-service-row__label">{service.label}</span>
              <span className="pomich-service-row__hint">{nearby.length > 0 ? "Найближчий партнер поруч" : "Підключимо диспетчера"}</span>
            </span>
            <span className="pomich-service-row__chevron">›</span>
          </button>
        ))}
      </div>
      </div>

      <div data-sheet-peek>
        <div className="pomich-sheet-section-head" style={{ marginTop: 4 }}>
          <div className="pomich-sheet-section-title">Що сталося?</div>
          <div className="pomich-sheet-badge" style={{ background: nearby.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: nearby.length > 0 ? BRAND : "var(--pomich-warn-text)" }}>
            {nearby.length > 0 ? `${nearby.length} поруч` : "диспетчер"}
          </div>
        </div>
        {services[0] ? (
          <button type="button" onClick={() => handleSelect(services[0].key as ServiceKey)} disabled={!profileReady} className="pomich-service-row" style={{ background: profileReady ? CARD : GHOST, opacity: profileReady ? 1 : 0.7 }}>
            <span className="pomich-service-row__icon" style={{ background: services[0].tone }}>{services[0].emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span className="pomich-service-row__label">{services[0].label}</span>
              <span className="pomich-service-row__hint">Проведіть вгору для всіх послуг</span>
            </span>
            <span className="pomich-service-row__chevron">›</span>
          </button>
        ) : null}
      </div>
    </RideScreen>
  )
}

function LocationStep({
  pickup,
  addressLabel,
  geoMessage,
  geoLoading,
  geoError,
  recenterTrigger,
  isTelegram,
  onPick,
  onRetryGeo,
  onBack,
  onNext,
}: {
  pickup: Point
  addressLabel: string
  geoMessage: string
  geoLoading: boolean
  geoError?: string
  recenterTrigger: number
  isTelegram?: boolean
  onPick: (point: Point) => void
  onRetryGeo: () => void
  onBack: () => void
  onNext: () => void
}) {
  const geoStatusHint = geoError ? undefined : geoLoading ? "Визначаємо ваше місцезнаходження…" : geoMessage

  return (
    <RideScreen pickup={pickup} mapSubtitle="Ваше місцезнаходження · перетягніть маркер" onPick={onPick} mapFocus onRetryGeo={onRetryGeo} geoLoading={geoLoading} geoError={geoError} recenterTrigger={recenterTrigger}>
      <div data-sheet-peek>
        <SheetHeading title="Де ви зараз?" subtitle={geoLoading ? "Визначаємо адресу…" : addressLabel} />
      </div>
      <div data-sheet-full>
      <StepBadge step={2} />
      <button onClick={onBack} style={{ border: "none", background: GHOST, color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Де ви зараз?" subtitle="Це місце, де вас знайде партнер. Перетягніть маркер на карті або натисніть, щоб уточнити." />

      <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px 10px", background: SURFACE_TONE }}>
        <LocationRow icon="📍" title="Адреса" subtitle={geoLoading ? "Визначаємо адресу…" : addressLabel} active />
        {geoStatusHint ? (
          <div style={{ margin: "0 0 8px 47px", color: MUTED, fontSize: 11, fontWeight: 750, lineHeight: 1.35 }}>{geoStatusHint}</div>
        ) : null}
      </div>

      {geoError ? (
        <div style={{ marginTop: 10, background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: "10px 12px", fontSize: 12, fontWeight: 800 }}>
          {geoError}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        {isTelegram ? null : <PrimaryButton label="Підтвердити місце" onClick={onNext} />}
      </div>
      </div>
    </RideScreen>
  )
}

function DestinationStep({
  pickup,
  destination,
  value,
  serviceKey,
  onPick,
  onChange,
  onNext,
  onBack,
  onSkipOnSite,
}: {
  pickup: Point
  destination: Point
  value: string
  serviceKey: ServiceKey
  onPick: (point: Point) => void
  onChange: (value: string) => void
  onNext: () => void
  onBack: () => void
  onSkipOnSite?: () => void
}) {
  const needsDestination = serviceRequiresDestination(serviceKey)
  const title = needsDestination ? "Куди доставити авто?" : "Допомога на місці"
  const subtitle = needsDestination
    ? "Натисніть на карті або введіть адресу СТО / точки доставки."
    : ON_SITE_DESTINATION_LABEL

  return (
    <RideScreen pickup={pickup} destination={needsDestination ? destination : pickup} mapSubtitle={needsDestination ? "Оберіть точку на карті" : "Ваше місцезнаходження"} onPick={needsDestination ? onPick : undefined} mapFocus={needsDestination}>
      <div data-sheet-peek>
        <SheetHeading title={title} subtitle={value.trim() || (needsDestination ? "Оберіть точку на карті" : ON_SITE_DESTINATION_LABEL)} />
      </div>
      <div data-sheet-full>
      <StepBadge step={3} />
      <button onClick={onBack} style={{ border: "none", background: GHOST, color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title={title} subtitle={subtitle} />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: SURFACE_TONE }}>
        <LocationRow icon="●" title="Звідки" subtitle="Ваше місцезнаходження" active />
        {needsDestination ? (
          <>
            <SheetDivider />
            <LocationRow icon="🏁" title="Куди" subtitle={value.trim() || "Оберіть на карті або введіть адресу"} />
          </>
        ) : (
          <>
            <SheetDivider />
            <LocationRow icon="🛠️" title="Куди" subtitle={ON_SITE_DESTINATION_LABEL} />
          </>
        )}
      </div>

      {needsDestination ? (
        <>
          <label style={{ display: "grid", gap: 8, marginTop: 16 }}>
            <span style={{ fontWeight: 900, color: DARK }}>Адреса доставки</span>
            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Наприклад: СТО «Авторемонт»"
              style={{ width: "100%", minHeight: 50, padding: "0 14px", borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 15, fontWeight: 750, fontFamily: "inherit", background: "var(--pomich-input-bg)", color: "var(--pomich-text)" }}
            />
          </label>
          <div style={{ color: MUTED, fontSize: 12, fontWeight: 750, marginTop: 8 }}>Точка: {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</div>
          <div style={{ marginTop: 16 }}>
            <PrimaryButton label="Далі" onClick={onNext} disabled={!value.trim()} />
          </div>
        </>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <div style={{ background: "var(--pomich-info-bg)", color: "var(--pomich-info-text)", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
            Партнер приїде до вас. Окрему точку «куди везти» вказувати не потрібно.
          </div>
          <PrimaryButton label="Далі" onClick={() => (onSkipOnSite ? onSkipOnSite() : onNext())} />
        </div>
      )}
      </div>
    </RideScreen>
  )
}

function DetailsStep({ pickup, destination, value, onChange, onNext, onBack }: { pickup: Point; destination: Point; value: string; onChange: (value: string) => void; onNext: () => void; onBack: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} mapSubtitle="Підбір виконавця">
      <button onClick={onBack} style={{ border: "none", background: GHOST, color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Що з автомобілем?" subtitle="Це допоможе підібрати правильний транспорт, інструменти та ETA." />

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {vehicleOptions.map((option) => (
          <button key={option} onClick={() => onChange(option)} style={{ minHeight: 54, padding: "12px 14px", borderRadius: 16, border: value === option ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: value === option ? SELECTED : CARD, textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontWeight: 900, color: DARK }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span>{option}</span>
              <span style={{ color: value === option ? BRAND : SUBTLE }}>{value === option ? "✓" : "○"}</span>
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

function ReviewStep({
  serviceLabel,
  serviceKey,
  addressLabel,
  destination,
  pickup,
  destinationPoint,
  vehicleState,
  customerComment,
  onCustomerCommentChange,
  loading,
  isTelegram,
  onConfirm,
  onBack,
}: {
  serviceLabel: string
  serviceKey: ServiceKey
  addressLabel: string
  destination: string
  pickup: Point
  destinationPoint: Point
  vehicleState: string
  customerComment: string
  onCustomerCommentChange: (value: string) => void
  loading: boolean
  isTelegram?: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const showDestination = serviceRequiresDestination(serviceKey) && Boolean(destination.trim())
  const onSiteLabel = !serviceRequiresDestination(serviceKey)

  return (
    <RideScreen pickup={pickup} destination={onSiteLabel ? pickup : destinationPoint} mapSubtitle="Перевірка заявки">
      <StepBadge step={4} />
      <button onClick={onBack} style={{ border: "none", background: GHOST, color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад</button>
      <SheetHeading title="Перевірте заявку" subtitle="Ціну та час прибуття побачите після того, як партнер прийме заявку." />

      <div style={{ marginTop: 16, border: `1px solid ${BORDER}`, borderRadius: 18, padding: "4px 14px", background: SURFACE_TONE }}>
        <LocationRow icon="🛠️" title="Послуга" subtitle={serviceLabel} active />
        <SheetDivider />
        <LocationRow icon="📍" title="Де ви" subtitle={addressLabel} />
        {showDestination ? (
          <>
            <SheetDivider />
            <LocationRow icon="🏁" title="Куди" subtitle={destination} />
          </>
        ) : onSiteLabel ? (
          <>
            <SheetDivider />
            <LocationRow icon="🛠️" title="Куди" subtitle={ON_SITE_DESTINATION_LABEL} />
          </>
        ) : null}
        <SheetDivider />
        <LocationRow icon="🚗" title="Стан авто" subtitle={vehicleState} />
      </div>

      <label style={{ display: "grid", gap: 6, marginTop: 14 }}>
        <span style={{ color: MUTED, fontSize: "var(--pomich-text-xs)", fontWeight: 850 }}>Коментар до заявки (необов&apos;язково)</span>
        <textarea
          value={customerComment}
          onChange={(event) => onCustomerCommentChange(event.target.value.slice(0, 500))}
          placeholder="Наприклад: авто на паркінгу біля входу, ключі в салоні…"
          maxLength={500}
          className="pomich-comment-field"
        />
        <span style={{ color: SUBTLE, fontSize: "var(--pomich-text-xs)", fontWeight: 700, textAlign: "right" }}>{customerComment.length}/500</span>
      </label>

      <div style={{ marginTop: 12, background: "var(--pomich-info-bg)", color: "var(--pomich-info-text)", borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
        Після надсилання заявки перевірені партнери побачать ваше місцезнаходження, відстань і зможуть прийняти її.
      </div>

      <div style={{ marginTop: 16 }}>
        {isTelegram ? null : <PrimaryButton label="Надіслати заявку" onClick={onConfirm} loading={loading} disabled={loading} />}
      </div>
    </RideScreen>
  )
}

function SearchingStep({ orderId, status, order, pickup, destination, onCancel, onRetryDispatch }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onCancel: () => void; onRetryDispatch: () => void }) {
  const noProviders = order?.dispatchState === "NO_PROVIDERS_AVAILABLE"
  const offersSent = order?.dispatchInfo?.offersSent ?? order?.offers?.length ?? 0
  return (
    <RideScreen pickup={pickup} destination={destination} providers={order?.assignedProvider ? [order.assignedProvider] : undefined} mapSubtitle={orderId ? `#${orderId}` : "Очікуємо партнера"}>
      <StepBadge step={4} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Очікуємо партнера" subtitle={noProviders ? "Немає вільних партнерів поруч" : orderId ? `Замовлення #${orderId}` : "Шукаємо найближчого перевіреного партнера…"} />
        <StatusPill status={status} />
      </div>

      <div style={{ position: "relative", height: 142, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 8 }}>
        {[0, 1, 2].map((item) => (
          <div key={item} className="pulse-ring" style={{ position: "absolute", width: 70 + item * 42, height: 70 + item * 42, borderRadius: 999, background: BRAND, opacity: 0.12 }} />
        ))}
        <div style={{ width: 72, height: 72, borderRadius: 24, background: "var(--pomich-accent-panel-bg)", boxShadow: "0 16px 36px rgba(17,19,21,0.24)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>🚛</div>
      </div>

      <div style={{ color: MUTED, fontWeight: 750, lineHeight: 1.4 }}>{noProviders ? "Можна повторити пошук без створення нової заявки." : offersSent > 0 ? `Звернулися до ${offersSent} партнерів. Перший, хто підтвердить, отримає заявку.` : "Партнери бачать ваше місцезнаходження та відстань до вас."}</div>
      <div style={{ marginTop: 16 }}><Timeline status={status} /></div>
      <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
        {["Заявку надіслано", "Партнери переглядають деталі", "Очікуємо підтвердження"].map((item) => (
          <div key={item} style={{ background: SURFACE_TONE, borderRadius: 15, border: `1px solid ${BORDER}`, padding: "12px 14px", fontWeight: 850, color: DARK }}>✓ {item}</div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {noProviders ? <PrimaryButton label="Спробувати ще раз" onClick={onRetryDispatch} /> : null}
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function AcceptedStep({
  orderId,
  status,
  order,
  pickup,
  destination,
  confirming,
  confirmError,
  onConfirmPrice,
  onContact,
  onCancel,
}: {
  orderId?: string
  status: OrderStatus
  order?: OrderResponse
  pickup: Point
  destination: Point
  confirming: boolean
  confirmError?: string
  onConfirmPrice: () => void
  onContact: () => void
  onCancel: () => void
}) {
  const assignedProvider = order?.assignedProvider
  const eta = assignedProvider?.etaMinutes
  const proposedPrice = order?.partnerProposedPrice
  const partnerName = assignedProvider?.name ?? order?.providerName
  const priceLabel = typeof proposedPrice === "number" ? `${proposedPrice.toLocaleString("uk-UA")} ₴` : "—"

  return (
    <RideScreen pickup={pickup} destination={destination} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Партнер запропонував ціну" expandedSheet>
      <div data-sheet-peek>
        <SheetHeading title="Запропонована ціна" subtitle={typeof proposedPrice === "number" ? `${priceLabel} · підтвердіть` : "Очікуємо ціну від партнера"} />
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 28, fontWeight: 950, color: DARK }}>{priceLabel}</div>
          <StatusPill status={status} />
        </div>
      </div>
      <div data-sheet-full>
      <StepBadge step={4} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Партнер прийняв заявку" subtitle={orderId ? `Замовлення #${orderId}` : "Обговоріть ціну з партнером"} />
        <StatusPill status={status} />
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Прибуття</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{typeof eta === "number" ? `~${eta} хв` : "—"}</div>
        </div>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Запропонована ціна</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{priceLabel}</div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={assignedProvider} fallbackName={partnerName} allowDemoFallback={false} />
        {order?.partnerPriceNote ? (
          <div style={{ background: "#EFF6FF", borderRadius: 18, padding: 14, color: "#1D4ED8", fontWeight: 800, fontSize: 13, lineHeight: 1.45 }}>
            Примітка партнера: {order.partnerPriceNote}
          </div>
        ) : null}
        <div style={{ background: CARD, borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
        </div>
        <div style={{ background: "var(--pomich-warn-bg)", borderRadius: 18, padding: 14, color: "var(--pomich-warn-text)", fontWeight: 800, lineHeight: 1.45 }}>
          {partnerName ?? "Партнер"} запропонував {typeof proposedPrice === "number" ? priceLabel : "ціну"}. Підтвердіть або зв'яжіться для обговорення.
        </div>
        {confirmError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{confirmError}</div> : null}
      </div>
      <div className="pomich-price-confirm-actions">
        <PrimaryButton label={confirming ? "Підтверджуємо…" : "Підтвердити ціну"} onClick={onConfirmPrice} loading={confirming} disabled={confirming || typeof proposedPrice !== "number"} />
        <SecondaryButton label="Зв'язатися" onClick={onContact} />
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
      </div>
    </RideScreen>
  )
}

function AssignedStep({ orderId, status, order, pickup, destination, isTelegram, onTrack, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; isTelegram?: boolean; onTrack: () => void; onCancel: () => void }) {
  const assignedProvider = order?.assignedProvider
  const eta = assignedProvider?.etaMinutes ?? provider.etaMinutes
  const confirmedPrice = order?.partnerProposedPrice

  return (
    <RideScreen pickup={pickup} destination={destination} providers={assignedProvider ? [assignedProvider] : undefined} mapSubtitle="Ціна підтверджена">
      <StepBadge step={4} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Допомога їде до вас" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Прибуття</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>~{eta} хв</div>
        </div>
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Узгоджена ціна</div>
          <div style={{ fontSize: 28, fontWeight: 950, marginTop: 6 }}>{typeof confirmedPrice === "number" ? `${confirmedPrice.toLocaleString("uk-UA")} ₴` : "—"}</div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={assignedProvider} />
        <div style={{ background: CARD, borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
        </div>
        <div style={{ background: SELECTED, borderRadius: 18, padding: 14, color: DARK, fontWeight: 800 }}>{assignedProvider?.name ?? "Партнер"} їде до вас. ETA ~{eta} хв, узгоджена ціна {typeof confirmedPrice === "number" ? `${confirmedPrice.toLocaleString("uk-UA")} ₴` : ""}.</div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {isTelegram ? null : <PrimaryButton label="Дивитися маршрут" onClick={onTrack} />}
        <SecondaryButton label="Скасувати заявку" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function TrackingStep({ orderId, status, order, pickup, destination, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; onCancel: () => void }) {
  const liveProviderLocation = order?.assignedProvider?.location
  const hasLiveLocation = Boolean(liveProviderLocation && Number.isFinite(liveProviderLocation.lat) && Number.isFinite(liveProviderLocation.lng))
  const providerPosition = hasLiveLocation
    ? { lat: liveProviderLocation!.lat, lng: liveProviderLocation!.lng }
    : undefined
  const distanceKm = typeof order?.assignedProvider?.distanceKm === "number" ? order.assignedProvider.distanceKm : undefined
  const eta = typeof order?.assignedProvider?.etaMinutes === "number"
    ? order.assignedProvider.etaMinutes
    : typeof distanceKm === "number"
      ? Math.max(1, Math.ceil(distanceKm * 4))
      : undefined
  const distanceLabel =
    typeof distanceKm === "number"
      ? distanceKm < 0.15
        ? "Поруч із вами"
        : `${distanceKm.toFixed(1)} км від вас`
      : null
  const mapSubtitle = hasLiveLocation
    ? [eta ? `ETA ${eta} хв` : null, distanceLabel].filter(Boolean).join(" · ") || "Партнер у дорозі"
    : "Партнер прийняв · очікуємо геолокацію"

  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={providerPosition} mapSubtitle={mapSubtitle}>
      <StepBadge step={4} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Партнер у дорозі" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        {eta ? <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 999, padding: "9px 12px", fontWeight: 950 }}>{eta} хв</div> : null}
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} eta={eta} assignedProvider={order?.assignedProvider} allowDemoFallback={false} />
        <div style={{ background: CARD, borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ color: MUTED, fontSize: 13, fontWeight: 700, marginTop: 12 }}>
            {hasLiveLocation
              ? (typeof distanceKm === "number" && distanceKm < 0.15 ? "Партнер майже на місці." : "Партнер їде до точки подачі. Позиція оновлюється з GPS.")
              : "Партнер прийняв заявку. Карта покаже рух, щойно з’явиться його геолокація."}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label={eta ? `Очікувати · ${eta} хв` : "Очікуємо партнера"} disabled />
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
        <div style={{ background: CARD, borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Допомога надається</div>
          <div style={{ marginTop: 6, color: MUTED, fontWeight: 700 }}>Після завершення підтвердьте заявку, щоб оновити статус у POMICH.</div>
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
        <div style={{ background: CARD, borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Виконавець працює із заявкою</div>
          <div style={{ marginTop: 6, color: MUTED, fontWeight: 700 }}>Статус оновиться автоматично після завершення робіт у системі.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        <PrimaryButton label="Очікуємо завершення робіт" disabled />
        <SecondaryButton label="Скасувати" danger onClick={onCancel} />
      </div>
    </RideScreen>
  )
}






function IncomingOfferStep({
  offer,
  providerLocation,
  secondsLeft,
  saving,
  error,
  proposedPrice,
  priceNote,
  onProposedPriceChange,
  onPriceNoteChange,
  onAccept,
  onDecline,
  onAcceptBlocked,
}: {
  offer: DispatchOffer
  providerLocation: Point
  secondsLeft: number
  saving: boolean
  error?: string
  proposedPrice: string
  priceNote: string
  onProposedPriceChange: (value: string) => void
  onPriceNoteChange: (value: string) => void
  onAccept: () => void
  onDecline: () => void
  onAcceptBlocked?: (reason: "expired" | "price") => void
}) {
  const priceInputRef = useRef<HTMLInputElement>(null)
  const parsedPrice = Number(proposedPrice.replace(",", "."))
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0
  const customerPickup = offer.customerCoordinates ?? PICKUP
  const eta = offer.etaMinutes ?? Math.ceil((offer.distanceKm ?? 1) * 4)
  const distanceLabel = typeof offer.distanceKm === "number" ? `${offer.distanceKm.toFixed(1)} км до клієнта` : "Відстань уточнюється"

  useEffect(() => {
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
    if (coarse) return
    const timer = window.setTimeout(() => {
      priceInputRef.current?.focus()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [offer.id])

  const handleAcceptClick = () => {
    if (saving) return
    if (secondsLeft <= 0) {
      onAcceptBlocked?.("expired")
      return
    }
    if (!priceValid) {
      onAcceptBlocked?.("price")
      priceInputRef.current?.focus()
      return
    }
    onAccept()
  }

  return (
    <ScreenLayout
      footer={(
        <div className="pomich-offer-accept-footer">
          {error ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{error}</div> : null}
          <PrimaryButton label={saving ? "Приймаємо…" : secondsLeft <= 0 ? "Час вийшов" : "ПРИЙНЯТИ З ЦІНОЮ"} onClick={handleAcceptClick} disabled={saving} />
          <SecondaryButton label="ПРОПУСТИТИ" onClick={onDecline} />
        </div>
      )}
    >
      <Header title="Нове замовлення" subtitle={secondsLeft > 0 ? `${secondsLeft} сек на відповідь` : "Час вийшов"} status="searching" />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <RouteMap
          pickup={customerPickup}
          providers={[{ id: offer.providerId, name: "Ви", status: "online", location: providerLocation, etaMinutes: eta }]}
          subtitle={`${distanceLabel} · ~${eta} хв`}
        />
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>Відстань до клієнта</div>
          <div style={{ fontSize: 32, fontWeight: 950, marginTop: 6 }}>{typeof offer.distanceKm === "number" ? `${offer.distanceKm.toFixed(1)} км` : "—"}</div>
          <div style={{ color: "#D1FAE5", fontWeight: 800, marginTop: 4 }}>~{eta} хв до місця подачі</div>
        </div>
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 950, fontSize: 20, color: DARK }}>{getServiceEmoji(offer.service)} {getProviderCapabilityLabel(offer.service)}</div>
              <div style={{ color: MUTED, fontWeight: 750, marginTop: 5 }}>{distanceLabel}</div>
            </div>
            <div style={{ background: SELECTED, color: BRAND, borderRadius: 999, padding: "8px 10px", fontWeight: 950 }}>~{eta} хв</div>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 8, color: DARK, fontSize: 13 }}>
            <div><strong>Авто:</strong> {offer.vehicleState ?? "Не вказано"}</div>
            <div><strong>Район:</strong> {offer.approximateLocation ?? "Поруч із вами"}</div>
            {offer.customerComment ? (
              <div style={{ background: "var(--pomich-info-bg)", color: "var(--pomich-info-text)", borderRadius: 12, padding: "10px 12px", lineHeight: 1.4 }}>
                <strong>Коментар клієнта:</strong> {offer.customerComment}
              </div>
            ) : null}
          </div>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 950, color: DARK, fontSize: 13 }}>Ваша ціна клієнту, грн</span>
          <input
            ref={priceInputRef}
            value={proposedPrice}
            onChange={(event) => onProposedPriceChange(event.target.value.replace(/[^\d.,]/g, ""))}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="Наприклад: 1200"
            aria-label="Вартість послуги в гривнях"
            className="pomich-offer-price-input"
            style={{
              width: "100%",
              minHeight: 52,
              padding: "0 14px",
              borderRadius: 14,
              border: `2px solid ${error && !priceValid ? "var(--pomich-error-text)" : BRAND}`,
              fontSize: 22,
              fontWeight: 950,
              fontFamily: "inherit",
              background: "var(--pomich-input-bg)",
              color: DARK,
              boxSizing: "border-box",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 8, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
          <span style={{ fontWeight: 850, color: DARK, fontSize: 13 }}>Примітка до ціни (необов'язково)</span>
          <input
            value={priceNote}
            onChange={(event) => onPriceNoteChange(event.target.value)}
            placeholder="Що входить у вартість"
            style={{ width: "100%", minHeight: 46, padding: "0 14px", borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 14, fontWeight: 700, fontFamily: "inherit" }}
          />
        </label>
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

const landingSteps = [
  ["1", "Оберіть проблему", "Евакуатор, акумулятор, колесо, пальне, замок або інша несправність."],
  ["2", "Де ви зараз?", "Перевірте маркер на карті — партнер приїде саме сюди."],
  ["3", "Перевірте заявку", "Перегляньте деталі та надішліть заявку — без ціни та ETA до прийняття."],
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
    /* Header is always dark glass over the map — light slate vanishes on it. */
    navText: "#F8FAFC",
    badgeBg: isDark ? "rgba(22,163,106,0.12)" : "#EAFBF2",
    badgeBorder: isDark ? "rgba(22,163,106,0.38)" : "#A8EBC7",
    badgeText: colors.badgeText,
    cardBorder: colors.glassCardBorder,
    cardShadow: colors.cardShadow,
    ghostBg: colors.ghostBg,
    ghostBorder: colors.ghostBorder,
    footer: isDark ? "rgba(9, 11, 14, 0.78)" : "rgba(238, 244, 248, 0.82)",
    menu: isDark ? "rgba(24, 28, 36, 0.98)" : "rgba(255,255,255,0.98)",
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

function LandingButton({ children, onClick, theme, variant = "primary", compact = false, className }: { children: React.ReactNode; onClick?: () => void; theme: LandingTheme; variant?: "primary" | "secondary" | "ghost"; compact?: boolean; className?: string }) {
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"
  return (
    <button
      onClick={onClick}
      className={["landing-cta-btn", className].filter(Boolean).join(" ")}
      style={{
        minHeight: compact ? 48 : 54,
        border: isGhost ? `1px solid ${theme.ghostBorder}` : "none",
        borderRadius: compact ? 12 : 14,
        padding: compact ? "0 16px" : "0 22px",
        fontSize: compact ? 14 : 15,
        background: isPrimary ? "linear-gradient(135deg, #16A36A 0%, #1A8F6A 48%, #2F80ED 100%)" : isGhost ? theme.ghostBg : "linear-gradient(135deg, #2F80ED 0%, #3B9AE8 55%, #C9A227 100%)",
        color: isGhost ? theme.text : "#fff",
        boxShadow: isGhost ? "none" : isPrimary ? "0 14px 32px rgba(22,163,106,0.28)" : "0 14px 32px rgba(47,128,237,0.22)",
        fontFamily: "inherit",
        fontWeight: 900,
        cursor: "pointer",
        width: "100%",
        letterSpacing: "0.01em",
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
}: {
  providers: ProviderAvailability[]
  theme: LandingTheme
  isDark: boolean
}) {
  const heroProviders = providers.length > 0 ? providers : landingHeroProviders
  return (
    <PomichMapBackground
      providers={heroProviders}
      variant="hero"
      fixed
      fadeBottom={theme.heroFadeBottom}
    />
  )
}

function LandingPage({
  onSelect,
  onRegister,
  onLogin,
  onHiddenAdmin,
}: {
  onSelect: (role: Role) => void
  onRegister: () => void
  onLogin: () => void
  onHiddenAdmin?: () => void
}) {
  /* Landing hero owns its own decorative map — avoid stacking the global shell map. */
  useSuppressMapAtmosphere()
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const isTelegram = telegramContext.isTelegram
  const layoutCompact = isTelegram || isMobile
  const [menuOpen, setMenuOpen] = useState(false)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [mapProviders, setMapProviders] = useState<ProviderAvailability[]>([])
  const [mapProvidersLoading, setMapProvidersLoading] = useState(true)
  const [mapUserLocation, setMapUserLocation] = useState<Point | undefined>(() => readLandingUserLocation())
  const [mapGeoStatus, setMapGeoStatus] = useState<"idle" | "requesting" | "success" | "error">(() => (readLandingUserLocation() ? "success" : "idle"))
  const landingRootRef = useRef<HTMLDivElement | null>(null)
  const { mode, colors, isDark } = usePomichTheme()
  const theme = buildLandingTheme(mode, colors)
  const preferredCity = normalizeServiceCity(
    typeof window !== "undefined" ? window.localStorage.getItem("pomichPreferredCity") : DEFAULT_SERVICE_CITY,
  )
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

  useEffect(() => {
    const root = landingRootRef.current
    const readScrollTop = () => {
      const fromRoot = root?.scrollTop ?? 0
      const fromWindow = window.scrollY || document.documentElement.scrollTop || 0
      return Math.max(fromRoot, fromWindow)
    }
    const onScroll = () => setHeaderScrolled(readScrollTop() > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    root?.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      root?.removeEventListener("scroll", onScroll)
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

  const headerH = layoutCompact ? 52 : 66

  return (
    <div
      ref={landingRootRef}
      className={isTelegram ? "tg-compact pomich-landing" : "pomich-landing"}
      style={{
        minHeight: "100dvh",
        background: "transparent",
        color: theme.text,
        ["--landing-header-h" as string]: `${headerH}px`,
      }}
    >
      {/* One fixed decorative map for the whole landing (website + Telegram WebApp). */}
      <LandingHeroBackground providers={mapProviders} theme={theme} isDark={isDark} />
      <header
        className={`pomich-landing-header${headerScrolled ? " is-scrolled" : ""}`}
        style={{ height: headerH, padding: layoutCompact ? "0 12px" : "0 28px" }}
      >
        <div className="pomich-landing-header__inner">
          <a href="#home" className="pomich-landing-header__brand" style={{ gap: layoutCompact ? 8 : 12 }}>
            <span className="pomich-landing-header__mark" style={{ width: layoutCompact ? 34 : 42, height: layoutCompact ? 34 : 42, fontSize: layoutCompact ? 16 : 20 }}>P</span>
            <span style={{ fontSize: layoutCompact ? 16 : 20 }}>POMICH</span>
          </a>
          {layoutCompact ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ThemeToggle compact={layoutCompact} />
              <button aria-label="Меню" onClick={() => setMenuOpen((value) => !value)} style={{ width: 44, height: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 10, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)", color: theme.text, fontSize: 22, fontWeight: 900, cursor: "pointer", backdropFilter: "blur(8px)" }}>☰</button>
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
          <div className="pomich-landing-header__menu" style={{ top: headerH, border: `1px solid ${theme.ghostBorder}`, padding: 12, display: "grid", gap: 4 }}>
            {navItems.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} style={{ color: theme.text, textDecoration: "none", fontWeight: 900, padding: "10px 10px", borderRadius: 6, fontSize: 14 }}>{label}</a>
            ))}
            <button type="button" onClick={() => { setMenuOpen(false); onLogin() }} style={{ marginTop: 6, minHeight: 44, border: `1px solid ${theme.ghostBorder}`, borderRadius: 8, background: theme.ghostBg, color: theme.text, fontFamily: "inherit", fontWeight: 900, cursor: "pointer" }}>Увійти</button>
            <button type="button" onClick={() => { setMenuOpen(false); onRegister() }} style={{ minHeight: 44, border: "none", borderRadius: 8, background: "linear-gradient(135deg, #16A36A 0%, #2F80ED 100%)", color: "#fff", fontFamily: "inherit", fontWeight: 900, cursor: "pointer" }}>Зареєструватися</button>
          </div>
        ) : null}
      </header>

      <main>
        <section
          id="home"
          className="landing-hero"
          style={{
            position: "relative",
            minHeight: layoutCompact ? "min(100dvh, 640px)" : "min(100dvh, 780px)",
            display: "flex",
            alignItems: layoutCompact ? "center" : "flex-end",
            justifyContent: layoutCompact ? "center" : "flex-start",
            paddingTop: headerH + (layoutCompact ? 28 : 36),
            paddingRight: layoutCompact ? 18 : 48,
            paddingBottom: layoutCompact ? 40 : 72,
            paddingLeft: layoutCompact ? 18 : 48,
            overflow: "visible",
          }}
        >
          <div
            className="landing-hero-content"
            style={{
              position: "relative",
              zIndex: 3,
              width: "100%",
              maxWidth: layoutCompact ? 420 : 560,
              textAlign: layoutCompact ? "center" : "left",
              margin: layoutCompact ? "0 auto" : "0",
            }}
          >
            <p className="landing-hero-eyebrow" style={{ margin: 0, color: isDark ? "rgba(185,220,200,0.92)" : "rgba(15,70,50,0.78)", fontSize: layoutCompact ? 12 : 13, fontWeight: 750, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              <span className="landing-hero-live-dot" aria-hidden />
              {preferredCity} · roadside
            </p>
            <h1
              className="landing-hero-brand"
              style={{
                margin: layoutCompact ? "14px 0 0" : "18px 0 0",
                fontFamily: "'Outfit', 'Manrope', sans-serif",
                fontSize: layoutCompact ? "clamp(64px, 18vw, 88px)" : "clamp(92px, 11vw, 132px)",
                lineHeight: 0.92,
                fontWeight: 800,
                letterSpacing: "-0.03em",
              }}
            >
              <span className="landing-hero-brand-word">
                {"POMICH".split("").map((letter, index) => (
                  <span
                    key={`${letter}-${index}`}
                    className="landing-hero-brand-letter"
                    style={{ animationDelay: `${0.08 + index * 0.06}s` }}
                  >
                    {letter}
                  </span>
                ))}
              </span>
              <span className="landing-hero-brand-sheen" aria-hidden />
              <span className="landing-hero-brand-underline" aria-hidden />
            </h1>
            <p
              className="landing-hero-title"
              style={{
                margin: layoutCompact ? "16px 0 0" : "20px 0 0",
                fontSize: layoutCompact ? 20 : "clamp(22px, 2.4vw, 28px)",
                lineHeight: 1.2,
                letterSpacing: "-0.01em",
                fontWeight: 800,
                maxWidth: layoutCompact ? "100%" : 440,
              }}
            >
              Допомога на дорозі — поруч
            </p>
            <p
              className="landing-hero-support"
              style={{
                margin: layoutCompact ? "10px auto 0" : "12px 0 0",
                maxWidth: layoutCompact ? 340 : 400,
                fontSize: layoutCompact ? 14 : 16,
                lineHeight: 1.5,
                fontWeight: 600,
              }}
            >
              Евакуатор, акумулятор, колесо чи механік у {preferredCity === "Ужгород" ? "Ужгороді" : preferredCity} та по Україні.
            </p>
            <div
              className="landing-hero-ctas"
              style={{
                margin: layoutCompact ? "22px auto 0" : "28px 0 0",
                display: "grid",
                gridTemplateColumns: layoutCompact ? "1fr" : "1fr 1fr",
                gap: 10,
                maxWidth: layoutCompact ? 320 : 420,
              }}
            >
              <LandingButton theme={theme} compact={layoutCompact} className="landing-hero-cta-primary" onClick={() => onSelect("customer")}>Потрібна допомога</LandingButton>
              <LandingButton theme={theme} compact={layoutCompact} variant="secondary" className="landing-hero-cta-secondary" onClick={() => onSelect("provider")}>Надаю послуги</LandingButton>
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
            <RouteMap
              pickup={LANDING_MAP_CENTER}
              providers={mapProviders}
              subtitle="Ужгород · довідник сервісів"
              full
              directoryOnly
              showLocateControl={false}
              userLocation={mapUserLocation}
              onUserLocationChange={(point) => {
                window.sessionStorage.setItem("pomichLandingGeo", JSON.stringify(point))
                setMapUserLocation(point)
                setMapGeoStatus("success")
              }}
            />
            <div className="landing-map-frame__wash" style={{ background: theme.mapOverlay }} aria-hidden />
            <button
              type="button"
              className="landing-map-geo-btn"
              onClick={requestMapGeo}
              disabled={mapGeoStatus === "requesting"}
              style={{
                color: theme.text,
                fontSize: layoutCompact ? 11 : 12,
                cursor: mapGeoStatus === "requesting" ? "wait" : "pointer",
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

        <section id="contacts" className="pomich-landing-section-alt" style={{ padding: layoutCompact ? "24px 12px 32px" : "64px 24px 80px", background: "radial-gradient(circle at 50% 0%, rgba(22,163,106,0.18), transparent 34%)", textAlign: "center" }}>
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

      <footer className="pomich-landing-footer" style={{ borderTop: `1px solid ${theme.navBorder}`, background: theme.footer, padding: layoutCompact ? "16px 12px" : "28px 24px" }}>
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

function CustomerFlow({ onLogout }: { onLogout?: () => void } = {}) {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const initialCustomerId = useMemo(() => readPersistedCustomerId(telegramContext.chatId), [telegramContext.chatId])
  const [customerId, setCustomerId] = useState(initialCustomerId)
  const [customerAccessToken, setCustomerAccessToken] = useState<string | undefined>(() => readStoredAuthSession(authSessionStorageKey("customer", initialCustomerId), "customer", initialCustomerId))
  const customerAuthToken = customerAccessToken
  const restoredActiveOrder = useMemo(() => readActiveOrder(), [])
  const [screen, setScreen] = useState<Screen>(() => {
    const restoredStatus = restoredActiveOrder?.status
    if (!restoredStatus) return "home"
    const normalized = normalizeOrderStatus(restoredStatus)
    return normalized === "draft" ? "home" : screenForOrderStatus(normalized)
  })
  const [selectedService, setSelectedService] = useState<ServiceKey>("tow")
  const [destination, setDestination] = useState("")
  const [vehicleState, setVehicleState] = useState("Авто заводиться")
  const [customerComment, setCustomerComment] = useState("")
  const [loading, setLoading] = useState(false)
  const [priceConfirming, setPriceConfirming] = useState(false)
  const [priceConfirmError, setPriceConfirmError] = useState<string | undefined>()
  const [orderId, setOrderId] = useState<string | undefined>(() => restoredActiveOrder?.orderId)
  const [currentOrder, setCurrentOrder] = useState<OrderResponse | undefined>()
  const [status, setStatus] = useState<OrderStatus>(() => {
    const restoredStatus = restoredActiveOrder?.status
    return restoredStatus ? normalizeOrderStatus(restoredStatus) : "draft"
  })
  const [geoState, setGeoState] = useState<GeoState>("requesting")
  const [geoMessage, setGeoMessage] = useState("Визначаємо ваше місцезнаходження…")
  const [addressLabel, setAddressLabel] = useState("Визначаємо адресу…")
  const [geoRecenterTrigger, setGeoRecenterTrigger] = useState(0)
  const [pickup, setPickup] = useState<Point>(PICKUP)
  const explicitGeoRecenterRef = useRef(false)
  const pickupRef = useRef<Point>(PICKUP)
  const geoWatchDebounceRef = useRef<number | undefined>(undefined)
  const [destinationPoint, setDestinationPoint] = useState<Point>(DEFAULT_DESTINATION)
  const [nearbyProviders, setNearbyProviders] = useState<ProviderAvailability[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [customerReviewSaving, setCustomerReviewSaving] = useState(false)
  const [customerReviewError, setCustomerReviewError] = useState<string | undefined>()
  const [customerReviewSubmitted, setCustomerReviewSubmitted] = useState(false)
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile>(() => {
    const token = readStoredAuthSession(authSessionStorageKey("customer", initialCustomerId), "customer", initialCustomerId)
    const bootstrap = token || telegramContext.initData ? readBootstrapProfileForCustomer(initialCustomerId) : undefined
    if (bootstrap) {
      return enrichProfileWithTelegram(bootstrap, telegramContext, initialCustomerId)
    }
    return enrichProfileWithTelegram(undefined, telegramContext, initialCustomerId)
  })
  const [customerVerificationSaving, setCustomerVerificationSaving] = useState(false)
  const [customerVerificationError, setCustomerVerificationError] = useState<string | undefined>()
  const userInitiatedCancelRef = useRef(false)

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
    if (session.profile) setCustomerProfile((profile) => mergeCustomerProfiles(profile, { ...session.profile!, id: nextCustomerId }))
  }

  const ensureCustomerSession = async () => {
    if (telegramContext.initData) {
      const resolved = await resolveCustomerAuthSession(telegramContext)
      setCustomerId(resolved.customerId)
      setCustomerAccessToken(resolved.token)
      if (resolved.profile) setCustomerProfile(resolved.profile)
      return { customerId: resolved.customerId, token: resolved.token }
    }
    if (customerAuthToken) return { customerId, token: customerAuthToken }
    const session = await createGuestCustomerSession(guestSessionCustomerIdForRestore(customerId))
    applyCustomerSession(session)
    return { customerId: session.customerId ?? session.subjectId, token: session.accessToken }
  }

  useEffect(() => {
    purgeStaleCustomerSessions(initialCustomerId)
  }, [initialCustomerId])

  useEffect(() => {
    telegramContext.webApp?.ready?.()
    telegramContext.webApp?.expand?.()
  }, [telegramContext.webApp])

  useEffect(() => {
    if (!telegramContext.initData || isExplicitLogout(telegramContext.chatId)) return
    let cancelled = false

    resolveCustomerAuthSession(telegramContext)
      .then((resolved) => {
        if (cancelled) return
        setCustomerId(resolved.customerId)
        setCustomerAccessToken(resolved.token)
        if (resolved.profile) setCustomerProfile((current) => mergeCustomerProfiles(current, resolved.profile!))
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [telegramContext.initData, telegramContext.chatId, telegramContext.user?.first_name, telegramContext.user?.last_name, telegramContext.user?.username])

  useEffect(() => {
    if (!telegramContext.chatId || !telegramContext.initData) return

    getTelegramSession(telegramContext.chatId, telegramContext.initData)
      .then((session) => {
        if (session.customerId) setCustomerId(session.customerId)
        if (session.profile) setCustomerProfile((profile) => mergeCustomerProfiles(profile, { ...session.profile!, id: session.customerId ?? profile.id }))
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
    pickupRef.current = pickup
  }, [pickup])

  useEffect(() => {
    if (screen === "cancelled" || screen === "completed") return

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      reverseGeocodeAddress(pickup).then((label) => {
        if (!cancelled) setAddressLabel(label)
      })
    }, MAP_GEO_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [pickup, screen])

  useEffect(() => {
    if (screen === "cancelled" || screen === "completed") return
    if (geoState !== "success" && geoState !== "telegram") return

    let cancelled = false
    syncProfileCityFromGeo(pickup, customerId, customerAuthToken, customerProfile.city)
      .then((result) => {
        if (cancelled || !result) return
        setCustomerProfile((profile) => {
          const next = result.saved ? mergeCustomerProfiles(profile, result.saved) : { ...profile, city: result.city }
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(next))
          }
          return next
        })
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [pickup, geoState, customerId, customerAuthToken, customerProfile.city, screen])

  useEffect(() => {
    if (screen === "cancelled" || screen === "completed") return
    if (geoState === "telegram") return
    if (geoState !== "requesting") return
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoState("unavailable")
      setGeoMessage("Не вдалося визначити геолокацію.")
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextPoint = { lat: position.coords.latitude, lng: position.coords.longitude }
        setPickup(nextPoint)
        setGeoState("success")
        setGeoMessage("Місцезнаходження визначено.")
        if (explicitGeoRecenterRef.current) {
          explicitGeoRecenterRef.current = false
          setGeoRecenterTrigger((value) => value + 1)
        }
      },
      (error) => {
        setGeoState("permission-denied")
        if (error.code === error.PERMISSION_DENIED) {
          setGeoMessage("Доступ до геолокації заборонено.")
        } else {
          setGeoMessage("Не вдалося визначити геолокацію. Можна вибрати точку вручну.")
        }
      },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }, [geoState, screen])

  useEffect(() => {
    const mapScreens: Screen[] = ["home", "location", "destination"]
    if (!mapScreens.includes(screen)) return
    if (geoState !== "success" && geoState !== "telegram") return
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return
    if (typeof navigator.geolocation.watchPosition !== "function") return

    const applyGeoPosition = (latitude: number, longitude: number) => {
      const nextPoint = { lat: latitude, lng: longitude }
      if (!shouldRecenterMap(pickupRef.current, nextPoint, MAP_RECENTER_THRESHOLD_M)) return
      setPickup(nextPoint)
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        window.clearTimeout(geoWatchDebounceRef.current)
        geoWatchDebounceRef.current = window.setTimeout(() => {
          applyGeoPosition(position.coords.latitude, position.coords.longitude)
        }, MAP_GEO_DEBOUNCE_MS)
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
      window.clearTimeout(geoWatchDebounceRef.current)
    }
  }, [screen, geoState])

  const retryGeolocation = () => {
    explicitGeoRecenterRef.current = true
    setGeoState("requesting")
    setGeoMessage("Визначаємо ваше місцезнаходження…")
    setAddressLabel("Визначаємо адресу…")
  }

  const geoLoading = geoState === "requesting"
  const geoError = geoState === "permission-denied"
    ? "Дозвольте доступ до геолокації в браузері або Telegram, потім натисніть «Оновити»."
    : geoState === "unavailable"
      ? "Геолокація недоступна у цьому браузері."
      : undefined

  useEffect(() => {
    if (screen === "cancelled" || screen === "completed") return

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
  }, [screen])

  useEffect(() => {
    if (!orderId) return
    if (screen === "cancelled" || screen === "completed") return

    let cancelled = false

    const applyPolledOrder = (order: OrderResponse) => {
      if (cancelled) return
      const resolvedOrderId = order.id ?? orderId
      const nextStatus = normalizeOrderStatus(order.status)
      if (userInitiatedCancelRef.current && nextStatus !== "cancelled") {
        return
      }
      if (nextStatus === "cancelled") {
        userInitiatedCancelRef.current = false
      }
      setCurrentOrder(order)
      setStatus(nextStatus)
      if (resolvedOrderId) setOrderId(resolvedOrderId)
      persistActiveOrder(resolvedOrderId, nextStatus)
      setScreen((currentScreen) => {
        if (currentScreen === "cancelled" || currentScreen === "completed") {
          return currentScreen
        }
        const targetScreen = screenForOrderStatus(nextStatus)
        if (currentScreen === "tracking" && nextStatus !== "en_route" && nextStatus !== "arrived" && nextStatus !== "in_progress" && nextStatus !== "completed" && nextStatus !== "cancelled") {
          return currentScreen
        }
        if (nextStatus === "accepted") {
          return "accepted"
        }
        return targetScreen
      })
    }

    const refreshOrder = () => {
      getOrder(orderId)
        .then(applyPolledOrder)
        .catch(() => undefined)
    }

    refreshOrder()
    const interval = window.setInterval(refreshOrder, 2500)
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshOrder()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", refreshOrder)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", refreshOrder)
    }
  }, [orderId, screen])

  const serviceLabel = useMemo(() => services.find((item) => item.key === selectedService)?.label ?? "Евакуатор", [selectedService])
  const orderDistanceKm = useMemo(() => resolveOrderDistanceKm(selectedService, pickup, destinationPoint), [pickup, destinationPoint, selectedService])
  const breakdown = useMemo(() => calculatePrice(selectedService, orderDistanceKm), [orderDistanceKm, selectedService])

  const applyPickup = (point: Point, message = "Місце подачі оновлено вручну.") => {
    setPickup(point)
    setGeoState("success")
    setGeoMessage(message)
  }

  const confirmPickupLocation = () => {
    if (serviceRequiresDestination(selectedService)) {
      setDestination("")
      setDestinationPoint(DEFAULT_DESTINATION)
      setScreen("destination")
      return
    }
    const onSite = resolveServiceDestination(selectedService, pickup)
    setDestination(onSite.destination)
    setDestinationPoint(onSite.destinationPoint)
    setScreen("review")
  }

  const applyOnSiteDestination = () => {
    const onSite = resolveServiceDestination(selectedService, pickup)
    setDestination(onSite.destination)
    setDestinationPoint(onSite.destinationPoint)
    setScreen("review")
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
        destination: serviceRequiresDestination(selectedService)
          ? sanitizeLocation(destination)
          : (destination.trim() ? sanitizeLocation(destination) : ON_SITE_DESTINATION_LABEL),
        destinationCoordinates: serviceRequiresDestination(selectedService) ? destinationPoint : pickup,
        vehicleState,
        customerComment: customerComment.trim() || undefined,
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
      const nextStatus = normalizeOrderStatus(response.status ?? "searching")
      userInitiatedCancelRef.current = false
      setOrderId(response.id)
      setCurrentOrder(response)
      setStatus(nextStatus)
      if (response.id) persistActiveOrder(response.id, nextStatus)
      setScreen("searching")
    } catch {
      setScreen("error")
    } finally {
      setLoading(false)
    }
  }

  const cancelOrder = () => {
    userInitiatedCancelRef.current = true
    setStatus("cancelled")
    setScreen("cancelled")
    clearActiveOrder()
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
        window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(savedProfile))
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
    setScreen("tracking")
  }

  const contactAssignedProvider = () => {
    const phone = currentOrder?.assignedProvider?.phone ?? provider.phone
    const telegram = currentOrder?.assignedProvider?.telegram ?? provider.telegram
    if (phone) {
      window.location.href = `tel:${phone}`
      return
    }
    if (telegram) {
      window.location.href = `https://t.me/${telegram.replace(/^@/, "")}`
    }
  }

  const confirmProposedPrice = async () => {
    if (!orderId) return
    setPriceConfirming(true)
    setPriceConfirmError(undefined)
    try {
      const order = await confirmOrderPrice(orderId, customerAuthToken)
      setCurrentOrder(order)
      const nextStatus = normalizeOrderStatus(order.status)
      setStatus(nextStatus)
      persistActiveOrder(orderId, nextStatus)
      setScreen(screenForOrderStatus(nextStatus))
    } catch {
      setPriceConfirmError("Не вдалося підтвердити ціну. Спробуйте ще раз.")
    } finally {
      setPriceConfirming(false)
    }
  }

  const completeOrder = () => {
    setScreen("in_progress")
  }

  const restart = useCallback(() => {
    userInitiatedCancelRef.current = false
    setScreen("home")
    setStatus("draft")
    setOrderId(undefined)
    setCurrentOrder(undefined)
    setCustomerReviewSaving(false)
    setCustomerReviewError(undefined)
    setCustomerReviewSubmitted(false)
    clearActiveOrder()
  }, [])

  const submitCustomerOrderReview = useCallback(async ({ rating, comment }: { rating: number; comment: string }) => {
    if (!orderId) return
    setCustomerReviewSaving(true)
    setCustomerReviewError(undefined)
    try {
      const authorId = currentOrder?.customerId || customerId
      const updated = await submitOrderReview(
        orderId,
        {
          role: "customer",
          rating,
          comment,
          authorId,
        },
        customerAuthToken,
      )
      setCurrentOrder(updated)
      setCustomerReviewSubmitted(true)
    } catch (err) {
      const message = messageFromFetchError(err, "Не вдалося зберегти оцінку. Спробуйте ще раз.")
      // Idempotent: review already saved — treat as success and unlock continue/logout flow.
      if (message.includes("already") || message.includes("вже") || /REVIEW_ALREADY/i.test(String(err))) {
        setCustomerReviewSubmitted(true)
        try {
          const refreshed = await getOrder(orderId)
          setCurrentOrder(refreshed)
        } catch {
          /* ignore */
        }
      } else {
        setCustomerReviewError(message)
      }
    } finally {
      setCustomerReviewSaving(false)
    }
  }, [orderId, customerId, customerAuthToken, currentOrder?.customerId])

  const { isTelegram, haptic } = useTelegramUx()
  const profileReady = isCustomerReadyForOrder(customerProfile)
  const homeNeedsProfileSave = screen === "home" && !profileReady && !isCustomerProfileComplete(customerProfile)

  const goBackScreen = useCallback(() => {
    haptic("light")
    if (screen === "location") setScreen("home")
    else if (screen === "destination") setScreen("location")
    else if (screen === "review") setScreen(serviceRequiresDestination(selectedService) ? "destination" : "location")
    else setScreen("home")
  }, [screen, haptic, selectedService])

  const mainButtonOnClick = useCallback(() => {
    switch (screen) {
      case "home":
        haptic("medium")
        void verifyCustomerProfile()
        break
      case "location":
        haptic("medium")
        confirmPickupLocation()
        break
      case "destination":
        haptic("medium")
        if (serviceRequiresDestination(selectedService)) {
          if (destination.trim()) setScreen("review")
        } else {
          applyOnSiteDestination()
        }
        break
      case "review":
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
        // Review is optional — never trap the user on the completed screen.
        restart()
        break
      case "error":
        haptic("light")
        setScreen("review")
        break
      default:
        break
    }
  }, [screen, haptic, verifyCustomerProfile, confirmPickupLocation, applyOnSiteDestination, destination, selectedService, submitOrder, startTracking, restart, customerReviewSubmitted, currentOrder?.customerReview?.rating])

  const mainButtonText = useMemo(() => {
    switch (screen) {
      case "home":
        return "Зберегти профіль"
      case "location":
        return "Підтвердити місце"
      case "destination":
        return "Далі"
      case "review":
        return "Надіслати заявку"
      case "assigned":
        return "Дивитися маршрут"
      case "completed":
        return "Нова заявка"
      case "cancelled":
        return "Нова заявка"
      case "error":
        return "Повторити"
      default:
        return ""
    }
  }, [screen])

  const customerReviewDone = customerReviewSubmitted || Boolean(currentOrder?.customerReview?.rating)
  const mainButtonVisible =
    (homeNeedsProfileSave) ||
    ["location", "destination", "review", "assigned", "cancelled", "completed", "error"].includes(screen)
  const mainButtonEnabled =
    screen === "home" ? isCustomerProfileComplete(customerProfile) && !customerVerificationSaving :
    screen === "destination" ? (serviceRequiresDestination(selectedService) ? Boolean(destination.trim()) : true) :
    screen === "review" ? !loading :
    mainButtonVisible

  useTelegramMainButton({
    text: mainButtonText,
    visible: isTelegram && mainButtonVisible,
    enabled: mainButtonEnabled,
    loading: (screen === "review" && loading) || (screen === "home" && customerVerificationSaving),
    onClick: mainButtonOnClick,
  })

  useTelegramBackButton({
    visible: isTelegram && ["location", "destination", "review"].includes(screen),
    onClick: goBackScreen,
  })

  switch (screen) {
    case "location":
      return <LocationStep pickup={pickup} addressLabel={addressLabel} geoMessage={geoMessage} geoLoading={geoLoading} geoError={geoError} recenterTrigger={geoRecenterTrigger} isTelegram={isTelegram} onPick={(point) => applyPickup(point)} onRetryGeo={retryGeolocation} onBack={() => setScreen("home")} onNext={confirmPickupLocation} />
    case "destination":
      return <DestinationStep pickup={pickup} destination={destinationPoint} value={destination} serviceKey={selectedService} onPick={setDestinationFromMap} onChange={setDestination} onBack={() => setScreen("location")} onNext={() => setScreen("review")} onSkipOnSite={applyOnSiteDestination} />
    case "details":
      return <DetailsStep pickup={pickup} destination={destinationPoint} value={vehicleState} onChange={setVehicleState} onBack={() => setScreen(serviceRequiresDestination(selectedService) ? "destination" : "location")} onNext={() => setScreen("review")} />
    case "review":
      return <ReviewStep serviceLabel={serviceLabel} serviceKey={selectedService} addressLabel={addressLabel} destination={destination} pickup={pickup} destinationPoint={destinationPoint} vehicleState={vehicleState} customerComment={customerComment} onCustomerCommentChange={setCustomerComment} loading={loading} isTelegram={isTelegram} onConfirm={submitOrder} onBack={() => setScreen(serviceRequiresDestination(selectedService) ? "destination" : "location")} />
    case "searching":
      return <SearchingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onCancel={cancelOrder} onRetryDispatch={retryOrderDispatch} />
    case "accepted":
      return <AcceptedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} confirming={priceConfirming} confirmError={priceConfirmError} onConfirmPrice={confirmProposedPrice} onContact={contactAssignedProvider} onCancel={cancelOrder} />
    case "assigned":
      return <AssignedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} isTelegram={isTelegram} onTrack={startTracking} onCancel={cancelOrder} />
    case "tracking":
      return <TrackingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onCancel={cancelOrder} />
    case "arrived":
      return <ArrivedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onComplete={completeOrder} onCancel={cancelOrder} />
    case "in_progress":
      return <InProgressStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} onCancel={cancelOrder} />
    case "completed":
      return (
        <OrderFinalStep
          orderId={orderId}
          status="completed"
          order={currentOrder}
          pickup={pickup}
          destination={destinationPoint}
          onRestart={restart}
          onLogout={onLogout}
          showAction
          reviewMode="customer"
          reviewSaving={customerReviewSaving}
          reviewError={customerReviewError}
          reviewSubmitted={customerReviewDone}
          onSubmitReview={submitCustomerOrderReview}
        />
      )
    case "cancelled":
      return <OrderFinalStep orderId={orderId} status="cancelled" pickup={pickup} destination={destinationPoint} onRestart={restart} onLogout={onLogout} showAction />
    case "error":
      return <OrderErrorStep pickup={pickup} destination={destinationPoint} onRetry={() => setScreen("review")} showAction={!isTelegram} />
    case "home":
    default:
      return <HomeStep pickup={pickup} locationLabel={addressLabel || geoMessage} providers={nearbyProviders} providersLoading={providersLoading} customerProfile={customerProfile} customerVerificationSaving={customerVerificationSaving} customerVerificationError={customerVerificationError} customerToken={customerAuthToken} isTelegram={isTelegram} geoLoading={geoLoading} geoError={geoError} recenterTrigger={geoRecenterTrigger} onProfileChange={(patch) => setCustomerProfile((profile) => ({ ...profile, ...patch }))} onVerifyCustomer={verifyCustomerProfile} onProfileVerified={(saved) => setCustomerProfile((profile) => ({ ...profile, ...saved }))} onRetryGeo={retryGeolocation} onSelect={(service) => { if (!isCustomerReadyForOrder(customerProfile)) return; setSelectedService(service); setDestination(""); setDestinationPoint(pickup); setScreen("location") }} />
  }
}

function ProviderFlow({ providerToken, providerRegistered = false, onLogout, onRestoreAccount }: { providerToken?: string; providerRegistered?: boolean; onLogout?: () => void; onRestoreAccount?: () => void }) {
  const [providerId, setProviderId] = useState(() => getActiveProviderId())
  const providerSessionStorageKey = useMemo(() => authSessionStorageKey("provider", providerId), [providerId])
  const [providerAccessToken, setProviderAccessToken] = useState<string | undefined>(() => {
    if (isAuthSessionToken(providerToken)) return providerToken
    return readStoredAuthSession(authSessionStorageKey("provider", getActiveProviderId()), "provider", getActiveProviderId())
  })
  const providerAuthToken = providerAccessToken
  const [authError, setAuthError] = useState<string | undefined>()

  const applyProviderSession = (session: AuthSession) => {
    const resolvedId = resolveSessionProviderId(session, providerId)
    if (resolvedId) storeLinkedProviderId(resolvedId)
    if (resolvedId && resolvedId !== providerId) {
      setProviderId(resolvedId)
    }
    storeAuthSession(authSessionStorageKey("provider", resolvedId || providerId), session)
    setProviderAccessToken(session.accessToken)
    setAuthError(undefined)
    return resolvedId || providerId
  }
  const [accountLogin, setAccountLogin] = useState(providerId)
  const [accountPassword, setAccountPassword] = useState("")
  const [authSaving, setAuthSaving] = useState(false)
  const [loginView, setLoginView] = useState<"login" | "register">(() => (providerRegistered ? "login" : "register"))
  const [step, setStep] = useState<"register" | "verify" | "duty" | "offer" | "awaiting_price" | "navigation" | "arrived" | "completed">(() => {
    if (typeof window === "undefined") return "register"
    if (providerRegistered || window.localStorage.getItem(`pomichPartnerRegistered:${getActiveProviderId()}`)) return "duty"
    return "register"
  })
  const [onDuty, setOnDuty] = useState(false)
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [presenceToast, setPresenceToast] = useState<string | undefined>()
  const [registrationSaving, setRegistrationSaving] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | undefined>()
  const [incomingOffers, setIncomingOffers] = useState<DispatchOffer[]>([])
  const [mapProviders, setMapProviders] = useState<ProviderAvailability[]>([])
  const [mapRequestPins, setMapRequestPins] = useState<MapRequestPin[]>([])
  const [selectedRequestPin, setSelectedRequestPin] = useState<MapRequestPin | undefined>()
  const [sheetProposedPrice, setSheetProposedPrice] = useState("")
  const [activeOrder, setActiveOrder] = useState<OrderResponse | undefined>()
  const [offerError, setOfferError] = useState<string | undefined>()
  const [offerSaving, setOfferSaving] = useState(false)
  const [proposedPrice, setProposedPrice] = useState("")
  const [priceNote, setPriceNote] = useState("")
  const [offerClock, setOfferClock] = useState(Date.now())
  const [providerLocation, setProviderLocation] = useState<Point>(PROVIDER_START)
  const [partnerReviewSaving, setPartnerReviewSaving] = useState(false)
  const [partnerReviewError, setPartnerReviewError] = useState<string | undefined>()
  const [partnerReviewSubmitted, setPartnerReviewSubmitted] = useState(false)
  const [providerGeoLoading, setProviderGeoLoading] = useState(false)
  const [providerGeoError, setProviderGeoError] = useState<string | undefined>()
  const [providerRecenterTrigger, setProviderRecenterTrigger] = useState(0)
  const [providerProfile, setProviderProfile] = useState<ProviderAvailability>({
    id: providerId,
    name: "",
    rating: provider.rating,
    vehicle: "",
    plate: "",
    phone: "",
    telegram: "",
    status: "offline",
    etaMinutes: provider.etaMinutes,
    location: PROVIDER_START,
    specialties: [],
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
  })
  const [registrationForm, setRegistrationForm] = useState<PartnerRegistrationForm>(() => emptyPartnerRegistrationForm())
  const dismissedOfferIdRef = useRef<string | undefined>(undefined)
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
    verification: providerProfile.verification,
    trustedBadges: providerProfile.trustedBadges,
    providerKind: "dispatch",
  }
  const providerCanGoOnline = isProviderPhoneVerified(providerProfile)
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const customerIdForOtp = typeof window !== "undefined" ? readPersistedCustomerId(telegramContext.chatId) : null
  const customerTokenForOtp = customerIdForOtp
    ? readStoredAuthSession(authSessionStorageKey("customer", customerIdForOtp), "customer", customerIdForOtp)
    : undefined

  useEffect(() => {
    if (providerAuthToken) return

    if (isAuthSessionToken(providerToken)) {
      const subject = readAuthSessionSubject(providerToken) || providerId
      if (subject) storeLinkedProviderId(subject)
      if (subject && subject !== providerId) setProviderId(subject)
      storeAuthSession(authSessionStorageKey("provider", subject), {
        role: "provider",
        subjectId: subject,
        providerId: subject,
        tokenType: "Bearer",
        accessToken: providerToken!,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      })
      setProviderAccessToken(providerToken)
      setAuthError(undefined)
      return
    }

    let cancelled = false
    const customerId = customerIdForOtp
    const customerToken = customerTokenForOtp

    const openSession = async () => {
      // Prefer customer→provider self-session so a stale demo providerToken cannot bind the UI to provider-oleksandr.
      if (customerId && customerToken) {
        return createSelfProviderSession(customerId, customerToken)
      }
      if (providerToken) {
        return createProviderSession(providerId, providerToken)
      }
      throw new Error("provider_auth_missing")
    }

    openSession()
      .then((session) => {
        if (cancelled) return
        applyProviderSession(session)
      })
      .catch(() => {
        if (!cancelled && providerRegistered) {
          setAuthError("Партнерська сесія не відкрита. Увійдіть з логіном і паролем або зверніться до диспетчера.")
        }
      })

    return () => {
      cancelled = true
    }
  }, [customerIdForOtp, customerTokenForOtp, providerAuthToken, providerId, providerRegistered, providerToken])

  useEffect(() => {
    let cancelled = false

    getProviders()
      .then((providers) => {
        if (cancelled || !Array.isArray(providers)) return
        const currentProvider = providers.find((item) => item.id === providerId)
        if (!currentProvider) return
        const currentSpecialties = toServiceKeys(currentProvider.specialties)
        setProviderProfile((profile) => ({ ...profile, ...currentProvider, specialties: currentSpecialties.length > 0 ? currentSpecialties : profile.specialties }))
        if (currentProvider.registeredAt) {
          const vehicleFields = hydratePartnerVehicleFromProfile(currentProvider as { vehicle?: string; vehicleMake?: string; vehicleModel?: string })
          setRegistrationForm((form) => ({
            name: currentProvider.name || form.name,
            phone: currentProvider.phone || form.phone,
            telegram: currentProvider.telegram || form.telegram,
            ...vehicleFields,
            plate: currentProvider.plate || form.plate,
            city: (currentProvider as { city?: string }).city || form.city || "",
            specialties: currentSpecialties.length > 0 ? currentSpecialties : form.specialties,
            serviceRadiusKm: currentProvider.serviceRadiusKm ?? form.serviceRadiusKm,
            identityDocumentRef: form.identityDocumentRef,
            driverLicenseRef: form.driverLicenseRef,
            vehicleRegistrationRef: form.vehicleRegistrationRef,
            serviceProofRef: form.serviceProofRef,
            selfieRef: form.selfieRef,
          }))
          setStep(isProviderPhoneVerified(currentProvider) ? "duty" : "verify")
        } else {
          setStep("register")
        }
        setOnDuty(currentProvider.status === "online" || currentProvider.status === "busy")
        if (currentProvider.location) setProviderLocation(currentProvider.location)
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

  const retryProviderGeolocation = () => {
    setProviderGeoLoading(true)
    setProviderGeoError(undefined)
    requestCurrentPosition(
      (point) => {
        setProviderLocation(point)
        setProviderGeoLoading(false)
        setProviderRecenterTrigger((value) => value + 1)
      },
      (message) => {
        setProviderGeoLoading(false)
        setProviderGeoError(message)
      },
    )
  }

  useEffect(() => {
    if (!onDuty || !providerAuthToken) return

    const heartbeat = () => {
      const presenceId = readAuthSessionSubject(providerAuthToken) || providerId
      updateProviderPresence(presenceId, {
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
    if (!onDuty || !providerAuthToken || activeOrder || (step !== "duty" && step !== "offer")) return
    let cancelled = false

    const refreshOffers = () => {
      getProviderOffers(providerId, providerAuthToken)
        .then((offers) => {
          if (!cancelled) {
            const activeOffers = filterActiveOffers(Array.isArray(offers) ? offers : [], offerClock)
            setIncomingOffers(activeOffers)
            if (activeOffers.length > 0) setOfferError(undefined)
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
  }, [activeOrder, onDuty, providerAuthToken, providerId, step, offerClock])

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
              customerComment: offer?.customerComment ?? order.customerComment,
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

  const activeOffer = incomingOffers.find((offer) => isOfferActive(offer, offerClock))
  const secondsLeft = offerSecondsLeft(activeOffer, offerClock)

  useEffect(() => {
    if (!activeOffer) {
      dismissedOfferIdRef.current = undefined
      return
    }
    if (step !== "duty") return
    if (dismissedOfferIdRef.current === activeOffer.id) return
    setSelectedRequestPin(undefined)
    setOfferError(undefined)
    setStep("offer")
  }, [activeOffer?.id, step])

  useEffect(() => {
    if (step !== "offer" || !activeOffer || secondsLeft > 0) return
    // Keep the offer visible briefly with an error; do not wipe price-required state onto the empty duty map.
    setOfferError("Пропозиція вже завершилась. Очікуйте нову заявку.")
    setIncomingOffers((offers) => offers.filter((item) => item.id !== activeOffer.id))
    setSelectedRequestPin(undefined)
    setStep("duty")
  }, [activeOffer, secondsLeft, step])

  useEffect(() => {
    if (step !== "duty") return
    if (activeOffer || selectedRequestPin) return
    if (!offerError) return
    if (
      offerError === "Вкажіть вартість послуги в гривнях."
      || offerError.includes("Вкажіть вартість")
    ) {
      setOfferError(undefined)
    }
  }, [step, activeOffer, selectedRequestPin, offerError])

  const openOfferDetail = (offer: DispatchOffer) => {
    const pin = mapRequestPins.find((item) => item.id === offer.orderId || item.offerId === offer.id) ?? pinFromOffer(offer)
    setSelectedRequestPin(pin)
    setSheetProposedPrice(proposedPrice)
    setOfferError(undefined)
    setStep("offer")
  }

  const handleOfferAcceptBlocked = (reason: "expired" | "price") => {
    if (reason === "expired") {
      setOfferError("Пропозиція вже завершилась. Очікуйте нову заявку.")
      if (activeOffer) {
        setIncomingOffers((offers) => offers.filter((item) => item.id !== activeOffer.id))
      }
      setSelectedRequestPin(undefined)
      setStep("duty")
      return
    }
    setOfferError("Вкажіть вартість послуги в гривнях.")
  }

  const syncProposedPrice = (value: string) => {
    const cleaned = value.replace(/[^\d.,]/g, "")
    setProposedPrice(cleaned)
    setSheetProposedPrice(cleaned)
    if (offerError === "Вкажіть вартість послуги в гривнях.") setOfferError(undefined)
  }

  const acceptOffer = async (offer: DispatchOffer, priceOverride?: string) => {
    const priceSource = priceOverride ?? proposedPrice
    const parsedPrice = Number(priceSource.replace(",", "."))
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      setOfferError("Вкажіть вартість послуги в гривнях.")
      return
    }

    setOfferSaving(true)
    setOfferError(undefined)
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      const result = await acceptProviderOffer(providerId, offer.id, providerAuthToken, {
        proposedPrice: parsedPrice,
        priceNote: priceNote.trim() || undefined,
      })
      setActiveOrder(result.order)
      setProviderProfile((profile) => ({ ...profile, status: "busy", assignedOrderId: result.order.id } as ProviderAvailability))
      setIncomingOffers([])
      setSelectedRequestPin(undefined)
      setSheetProposedPrice("")
      setOnDuty(true)
      setProposedPrice("")
      setPriceNote("")
      setStep("awaiting_price")
    } catch (error) {
      const detail = (error as { detail?: { code?: string; message?: string } }).detail
      if (detail?.code === "PRICE_REQUIRED") {
        setOfferError("Вкажіть вартість послуги в гривнях.")
        return
      }
      setOfferError(detail?.code === "OFFER_EXPIRED" ? "Пропозиція вже завершилась." : "Замовлення вже прийняв інший виконавець.")
      setIncomingOffers((offers) => offers.filter((item) => item.id !== offer.id))
      setSelectedRequestPin(undefined)
      if (detail?.code === "OFFER_EXPIRED") setStep("duty")
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
      dismissedOfferIdRef.current = offer.id
      setIncomingOffers((offers) => offers.filter((item) => item.id !== offer.id))
      setStep("duty")
    } catch {
      setOfferError("Не вдалося пропустити заявку.")
    } finally {
      setOfferSaving(false)
    }
  }

  const openRequestPin = (pin: MapRequestPin) => {
    setSelectedRequestPin(pin)
    setSheetProposedPrice(proposedPrice)
    setOfferError(undefined)
    const matchedOffer = incomingOffers.find((item) => item.id === pin.offerId || item.orderId === pin.id)
    if (matchedOffer) {
      setStep("offer")
    }
  }

  const acceptFromMapPin = (pin: MapRequestPin) => {
    openRequestPin(pin)
  }

  const acceptFromSheet = async () => {
    if (!selectedRequestPin) return
    if (sheetProposedPrice.trim()) {
      setProposedPrice(sheetProposedPrice)
    }
    let offer = incomingOffers.find((item) => item.id === selectedRequestPin.offerId || item.orderId === selectedRequestPin.id)
    if (!offer) {
      setOfferSaving(true)
      setOfferError(undefined)
      try {
        if (!providerAuthToken) throw new Error("provider_session_missing")
        await retryDispatch(selectedRequestPin.id)
        const offers = await getProviderOffers(providerId, providerAuthToken)
        setIncomingOffers(Array.isArray(offers) ? offers : [])
        offer = offers.find((item) => item.orderId === selectedRequestPin.id)
      } catch {
        setOfferError("Не вдалося отримати заявку. Спробуйте ще раз.")
        setOfferSaving(false)
        return
      } finally {
        setOfferSaving(false)
      }
    }
    if (!offer) {
      setOfferError("Заявку надіслано. Очікуйте пропозицію протягом кількох секунд.")
      return
    }
    await acceptOffer(offer, sheetProposedPrice)
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
        setPartnerReviewSubmitted(Boolean(order.partnerReview?.rating))
        setPartnerReviewError(undefined)
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

  const ensureProviderSession = async (): Promise<{ token: string; providerId: string }> => {
    if (providerAuthToken) {
      const subject =
        readAuthSessionSubject(providerAuthToken) ||
        (typeof window !== "undefined" ? window.sessionStorage.getItem("pomichLinkedProviderId") : null) ||
        providerId
      if (subject && subject !== providerId) {
        setProviderId(subject)
        storeLinkedProviderId(subject)
      } else if (subject) {
        storeLinkedProviderId(subject)
      }
      return { token: providerAuthToken, providerId: subject }
    }

    const customerId =
      customerIdForOtp ||
      (typeof window !== "undefined"
        ? window.sessionStorage.getItem("pomichCustomerId") || window.localStorage.getItem("pomichCustomerId")
        : null)
    const customerToken = customerId
      ? readStoredAuthSession(authSessionStorageKey("customer", customerId), "customer", customerId)
      : undefined

    if (customerId && customerToken) {
      const linkedId = resolveProviderIdForCustomer(customerId)
      if (linkedId) storeLinkedProviderId(linkedId)
      await setUserPreferredRole(customerId, "provider", customerToken).catch(() => undefined)
      const session = await createSelfProviderSession(customerId, customerToken)
      const resolvedId = applyProviderSession(session)
      return { token: session.accessToken, providerId: resolvedId }
    }

    if (providerToken) {
      const session = await createProviderSession(providerId, providerToken)
      const resolvedId = applyProviderSession(session)
      return { token: session.accessToken, providerId: resolvedId }
    }

    throw Object.assign(new Error("provider_session_missing"), { detail: "provider_session_missing" })
  }

  const saveRegistration = async () => {
    const nameValidation = validatePersonName(registrationForm.name)
    const phoneValidation = validateUkraineMobilePhone(registrationForm.phone)
    const plateValidation = validateUkrainePlate(registrationForm.plate)
    const cityValidation = validateServiceCity(registrationForm.city || DEFAULT_SERVICE_CITY)
    const vehicleMake = resolvePartnerVehicleMake(registrationForm.vehicleMake, registrationForm.vehicleMakeOther)
    const vehicle = composePartnerVehicle(registrationForm.vehicleMake, registrationForm.vehicleModel, registrationForm.vehicleMakeOther)
    if (!nameValidation.valid || !phoneValidation.valid || !plateValidation.valid || !cityValidation.valid || !partnerVehicleSelectionIsComplete(registrationForm.vehicleMake, registrationForm.vehicleMakeOther, registrationForm.vehicleModel) || !vehicle.trim() || registrationForm.specialties.length === 0) {
      setRegistrationError(
        !nameValidation.valid
          ? (nameValidation.error || "Вкажіть коректне ім'я")
          : !phoneValidation.valid
            ? (phoneValidation.error || "Введіть коректний номер телефону")
            : !cityValidation.valid
              ? (cityValidation.error || "Оберіть місто")
              : !plateValidation.valid
                ? (plateValidation.error || "Введіть коректний номер авто")
                : "Заповніть профіль і оберіть хоча б одну послугу.",
      )
      return
    }

    setRegistrationSaving(true)
    setRegistrationError(undefined)
    try {
      const session = await ensureProviderSession()
      const updated = await updateProviderProfile(session.providerId, {
        name: nameValidation.value,
        phone: phoneValidation.e164,
        telegram: registrationForm.telegram,
        vehicle,
        vehicleMake,
        vehicleModel: registrationForm.vehicleModel,
        plate: plateValidation.plate,
        city: cityValidation.value,
        specialties: registrationForm.specialties,
        serviceRadiusKm: registrationForm.serviceRadiusKm,
        location: providerLocation,
      }, session.token)
      setProviderProfile((profile) => ({ ...profile, ...updated, specialties: toServiceKeys(updated.specialties) }))
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`pomichPartnerRegistered:${session.providerId}`, "1")
        window.localStorage.setItem("pomichPreferredCity", cityValidation.value)
      }
      setStep(isProviderPhoneVerified(updated) ? "duty" : "verify")
      setLoginView("login")
    } catch (error) {
      const code = error instanceof ApiRequestError ? error.code : undefined
      const message =
        error instanceof Error ? error.message : "Не вдалося зберегти профіль партнера. Перевірте підключення та спробуйте ще раз."
      setRegistrationError(
        code === "phone_already_registered" || /phone_already_registered/i.test(message)
          ? "Цей номер уже зареєстровано. Увійдіть за номером або використайте інший."
          : message,
      )
      // phone_already_registered: keep form + «Увійти за цим номером» CTA (onRestoreAccount).
    } finally {
      setRegistrationSaving(false)
    }
  }

  useEffect(() => {
    if (!presenceToast) return
    const timeout = window.setTimeout(() => setPresenceToast(undefined), 5000)
    return () => window.clearTimeout(timeout)
  }, [presenceToast])

  const setDuty = async (nextDuty: boolean) => {
    if (nextDuty && !providerCanGoOnline) {
      const message = "Підтвердіть телефон кодом у Telegram, щоб вийти на лінію."
      setOfferError(message)
      setPresenceToast(message)
      setStep("verify")
      return
    }
    setPresenceSaving(true)
    setOfferError(undefined)
    setPresenceToast(undefined)
    try {
      const session = await ensureProviderSession()
      const updated = await updateProviderPresence(session.providerId, {
        status: nextDuty ? "online" : "offline",
        location: providerLocation,
        etaMinutes: providerProfile.etaMinutes ?? provider.etaMinutes,
      }, session.token)
      setOnDuty(nextDuty)
      setProviderProfile((profile) => ({ ...profile, ...updated, status: updated.status ?? (nextDuty ? "online" : "offline") }))
    } catch (error) {
      setOnDuty(false)
      const detail = (error as { detail?: string }).detail
      const message =
        (typeof detail === "string" ? presenceErrorMessage(detail) : undefined) ||
        (error instanceof Error ? presenceErrorMessage(error.message) : presenceErrorMessage(undefined))
      setOfferError(message)
      setPresenceToast(message)
    } finally {
      setPresenceSaving(false)
    }
  }

  const handleDutyToggle = () => {
    if (presenceSaving) return
    if (!onDuty && !providerCanGoOnline) {
      setStep("verify")
      return
    }
    void setDuty(!onDuty)
  }

  const submitProviderAccountLogin = async () => {
    setAuthSaving(true)
    setAuthError(undefined)
    try {
      const session = await createProviderAccountSession(providerId, accountLogin, accountPassword)
      applyProviderSession(session)
      setAccountPassword("")
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не вдалося увійти в акаунт партнера.")
    } finally {
      setAuthSaving(false)
    }
  }

  useEffect(() => {
    if (!activeOrder?.id) return
    let cancelled = false

    const refreshActiveOrder = () => {
      getOrder(activeOrder.id!)
        .then((order) => {
          if (cancelled) return
          const normalizedStatus = normalizeOrderStatus(order.status)
          if (normalizedStatus === "cancelled") {
            setActiveOrder(undefined)
            setIncomingOffers([])
            setProviderProfile((profile) => ({ ...profile, status: "online", assignedOrderId: undefined } as ProviderAvailability))
            setStep("duty")
            return
          }
          setActiveOrder(order)
          if (step === "awaiting_price" && (normalizedStatus === "price_confirmed" || normalizedStatus === "en_route")) {
            setStep("navigation")
          } else if (normalizedStatus === "completed" && step !== "duty") {
            setProviderProfile((profile) => ({ ...profile, status: "online", assignedOrderId: undefined } as ProviderAvailability))
            setStep("completed")
          }
        })
        .catch(() => undefined)
    }

    refreshActiveOrder()
    const interval = window.setInterval(refreshActiveOrder, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeOrder?.id, step])

  const returnToDuty = useCallback(() => {
    setActiveOrder(undefined)
    setPartnerReviewSaving(false)
    setPartnerReviewError(undefined)
    setPartnerReviewSubmitted(false)
    setOfferError(undefined)
    setProviderProfile((profile) => ({
      ...profile,
      status: onDuty ? "online" : profile.status,
      assignedOrderId: undefined,
    } as ProviderAvailability))
    setStep("duty")
  }, [onDuty])

  const submitPartnerOrderReview = useCallback(async ({ rating, comment }: { rating: number; comment: string }) => {
    if (!activeOrder?.id) return
    setPartnerReviewSaving(true)
    setPartnerReviewError(undefined)
    try {
      const authorProviderId =
        activeOrder.assignedProviderId || activeOrder.partnerId || providerId
      const updated = await submitOrderReview(
        activeOrder.id,
        {
          role: "partner",
          rating,
          comment,
          authorId: authorProviderId,
          providerId: authorProviderId,
        },
        providerAuthToken,
      )
      setActiveOrder(updated)
      setPartnerReviewSubmitted(true)
    } catch (err) {
      const message = messageFromFetchError(err, "Не вдалося зберегти оцінку. Спробуйте ще раз.")
      if (message.includes("already") || message.includes("вже") || /REVIEW_ALREADY/i.test(String(err))) {
        setPartnerReviewSubmitted(true)
        try {
          const refreshed = await getOrder(activeOrder.id)
          setActiveOrder(refreshed)
        } catch {
          /* ignore */
        }
      } else {
        setPartnerReviewError(message)
      }
    } finally {
      setPartnerReviewSaving(false)
    }
  }, [activeOrder?.id, activeOrder?.assignedProviderId, activeOrder?.partnerId, providerId, providerAuthToken])

  const openPartnerRestoreOrLogin = () => {
    // Prefer phone OTP restore (linked provider) over password login dead-end.
    if (onRestoreAccount) {
      onRestoreAccount()
      return
    }
    setRegistrationError(undefined)
    setLoginView("login")
  }

  if (!providerAuthToken && !providerToken) {
    // Already-registered partner: wait for customer→provider self-session instead of flashing login/register.
    if (providerRegistered && customerIdForOtp && customerTokenForOtp) {
      return <div className="pomich-boot-screen">Завантажуємо кабінет партнера…</div>
    }
    if (loginView === "register") {
      return (
        <ProviderRegistrationStep
          form={registrationForm}
          saving={registrationSaving}
          error={registrationError}
          onChange={updateRegistrationForm}
          onToggleSpecialty={toggleRegistrationSpecialty}
          onSubmit={saveRegistration}
          onLogin={openPartnerRestoreOrLogin}
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

  if (step === "verify") {
    const otpProfile: CustomerProfile = {
      id: customerIdForOtp || providerId,
      name: providerProfile.name || registrationForm.name,
      phone: providerProfile.phone || registrationForm.phone,
      verificationStatus: providerProfile.verificationStatus,
    }
    return (
      <ScreenLayout>
        <Header title="Підтвердження телефону" subtitle="Спочатку телефон, потім код з Telegram" />
        <FormContainer>
          <div className="pomich-form-card">
            <OtpVerificationPanel
              profile={otpProfile}
              customerToken={customerTokenForOtp}
              isTelegram={telegramContext.isTelegram}
              phone={otpProfile.phone}
              onPhoneSaved={(savedPhone) => {
                setRegistrationForm((form) => ({ ...form, phone: savedPhone }))
                setProviderProfile((profile) => ({ ...profile, phone: savedPhone }))
              }}
              onVerified={async () => {
                const providers = await getProviders()
                const currentProvider = Array.isArray(providers) ? providers.find((item) => item.id === providerId) : undefined
                if (currentProvider) {
                  setProviderProfile((profile) => ({ ...profile, ...currentProvider, specialties: toServiceKeys(currentProvider.specialties) }))
                } else {
                  setProviderProfile((profile) => ({ ...profile, verificationStatus: "verified", verification: { ...profile.verification, phone: true } }))
                }
                setStep("duty")
              }}
            />
          </div>
        </FormContainer>
      </ScreenLayout>
    )
  }

  if (step === "register") {
    return (
      <ProviderRegistrationStep
        form={registrationForm}
        saving={registrationSaving}
        error={registrationError}
        onChange={updateRegistrationForm}
        onToggleSpecialty={toggleRegistrationSpecialty}
        onSubmit={saveRegistration}
        onLogin={onRestoreAccount ? openPartnerRestoreOrLogin : undefined}
      />
    )
  }

  if (step === "duty") {
    return (
      <>
      <RideScreen
        pickup={providerLocation}
        providers={onDuty ? [providerPresence, ...mapProviders] : mapProviders}
        requestPins={mapRequestPins}
        mapSubtitle={onDuty ? `На лінії · ${mapRequestPins.length} заявок поруч` : "Ужгород · партнер"}
        showAllProviders={onDuty}
        mapFocus={Boolean(activeOffer)}
        onAcceptRequest={acceptFromMapPin}
        onContactRequest={contactFromMapPin}
        onRequestPinSelect={openRequestPin}
        onRetryGeo={retryProviderGeolocation}
        geoLoading={providerGeoLoading}
        geoError={providerGeoError}
        recenterTrigger={providerRecenterTrigger}
      >
        <SheetHeading title="Партнер POMICH" subtitle={onDuty ? "Ви на лінії — заявки на карті" : "Вийдіть на лінію, щоб бачити заявки"} />
        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {authError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{authError}</div> : null}
          {activeOffer ? (
            <div style={{ background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: 12, fontWeight: 850, fontSize: "var(--pomich-text-sm)" }}>
              Нова заявка · {secondsLeft > 0 ? `${secondsLeft} сек` : "час вийшов"} — відкрийте деталі нижче
            </div>
          ) : null}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ color: MUTED, fontWeight: 800, fontSize: 12 }}>Статус зміни</div>
                <div style={{ color: DARK, fontWeight: 950, fontSize: 22, marginTop: 4 }}>{onDuty ? "На лінії" : "Поза лінією"}</div>
              </div>
              <DutyStatusToggle onDuty={onDuty} saving={presenceSaving} disabled={presenceSaving} onToggle={handleDutyToggle} />
            </div>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ background: BG, borderRadius: 14, padding: 12 }}>
                <div style={{ color: MUTED, fontSize: 12, fontWeight: 800 }}>Заявки на карті</div>
                <div style={{ color: DARK, fontWeight: 950, marginTop: 4 }}>{mapRequestPins.length}</div>
              </div>
              <div style={{ background: BG, borderRadius: 14, padding: 12 }}>
                <div style={{ color: MUTED, fontSize: 12, fontWeight: 800 }}>Сервісів Ужгорода</div>
                <div style={{ color: DARK, fontWeight: 950, marginTop: 4 }}>{mapProviders.filter((item) => item.providerKind === "directory").length}</div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {onDuty ? (
              <>
                <PrimaryButton
                  label={offerSaving ? "Приймаємо…" : activeOffer ? "Відкрити заявку" : "Оновити карту"}
                  onClick={() => {
                    if (activeOffer) {
                      openOfferDetail(activeOffer)
                    }
                  }}
                  disabled={offerSaving}
                />
                <SecondaryButton label="Піти з лінії" onClick={() => setDuty(false)} disabled={!providerAuthToken} />
              </>
            ) : (
              <PrimaryButton label={!providerCanGoOnline ? "Підтвердити телефон" : presenceSaving ? "Оновлюємо статус…" : "Вийти на лінію"} onClick={() => (providerCanGoOnline ? setDuty(true) : setStep("verify"))} disabled={presenceSaving} />
            )}
            <SecondaryButton label="Редагувати профіль" onClick={() => setStep("register")} />
          </div>
          {offerError && offerError !== "Вкажіть вартість послуги в гривнях." ? <div style={{ background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: 12, fontWeight: 850 }}>{offerError}</div> : null}
        </div>
        {presenceToast ? <PresenceToast message={presenceToast} /> : null}
      </RideScreen>
      {selectedRequestPin ? (
        <OrderRequestSheet
          pin={selectedRequestPin}
          proposedPrice={sheetProposedPrice}
          saving={offerSaving}
          error={offerError}
          secondsLeft={secondsLeft}
          onProposedPriceChange={syncProposedPrice}
          onAccept={() => void acceptFromSheet()}
          onClose={() => {
            setSelectedRequestPin(undefined)
            setOfferError(undefined)
          }}
          onAcceptBlocked={handleOfferAcceptBlocked}
        />
      ) : null}
      </>
    )
  }

  if (step === "completed") {
    const partnerReviewDone = partnerReviewSubmitted || Boolean(activeOrder?.partnerReview?.rating)
    const completedPickup = activeOrder?.customerCoordinates ?? pickup
    const completedDestination = activeOrder?.destinationCoordinates ?? destination
    return (
      <OrderFinalStep
        orderId={activeOrder?.id}
        status="completed"
        order={activeOrder}
        pickup={completedPickup}
        destination={completedDestination}
        onRestart={returnToDuty}
        onLogout={onLogout}
        showAction
        reviewMode="partner"
        reviewSaving={partnerReviewSaving}
        reviewError={partnerReviewError}
        reviewSubmitted={partnerReviewDone}
        onSubmitReview={submitPartnerOrderReview}
      />
    )
  }

  if (step === "awaiting_price") {
    const proposed = activeOrder?.partnerProposedPrice
    return (
      <ScreenLayout footer={<SecondaryButton label="Повернутись до карти" onClick={returnToDuty} />}>
        <Header title="Очікуємо клієнта" subtitle={activeOrder?.id ? `Замовлення #${activeOrder.id}` : undefined} status="accepted" />
        <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
            <div style={{ fontWeight: 950, fontSize: 20, color: DARK }}>Ціну надіслано клієнту</div>
            <div style={{ color: MUTED, fontWeight: 750, marginTop: 8, lineHeight: 1.45 }}>
              Ви запропонували {typeof proposed === "number" ? `${proposed.toLocaleString("uk-UA")} ₴` : "ціну"}. Клієнт підтвердить або зв'яжеться для обговорення.
            </div>
            <div style={{ marginTop: 14 }}>
              <Timeline status="accepted" />
            </div>
          </div>
          {offerError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{offerError}</div> : null}
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
          <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14 }}>
            <Timeline status={activeStatus === "in_progress" ? "in_progress" : "arrived"} />
            <div style={{ fontWeight: 900, color: DARK, marginTop: 16 }}>Поточна дія</div>
            <div style={{ color: MUTED, fontWeight: 700, marginTop: 6 }}>Підтвердіть завершення, коли допомогу надано.</div>
          </div>
        </div>
      </ScreenLayout>
    )
  }

  if (step === "navigation") {
    const activeStatus = normalizeOrderStatus(activeOrder?.status)
    const nextStatus: OrderStatus = activeStatus === "price_confirmed" || activeStatus === "assigned" || activeStatus === "accepted" ? "en_route" : "arrived"
    const hasLiveGps = Number.isFinite(providerLocation.lat) && Number.isFinite(providerLocation.lng)
    const routePickup = activeOrder?.customerCoordinates ?? pickup
    const routeDestination = activeOrder?.destinationCoordinates ?? destination
    const customerLabel = activeOrder?.customerLocation || "Точка подачі клієнта"
    return (
      <ScreenLayout footer={<PrimaryButton label={activeStatus === "en_route" ? "Я НА МІСЦІ" : "ЇДУ ДО КЛІЄНТА"} onClick={() => activeOrder ? advanceProviderOrder(nextStatus) : setStep("arrived")} disabled={activeStatus === "accepted"} />}>
        <Header title="Маршрут до клієнта" subtitle={activeOrder?.id ? `Активне замовлення #${activeOrder.id}` : "Активне замовлення"} status={activeStatus === "en_route" ? "en_route" : "price_confirmed"} />
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
          <RouteMap
            pickup={routePickup}
            destination={routeDestination}
            providerPosition={hasLiveGps ? providerLocation : undefined}
            subtitle={hasLiveGps ? "Ваша GPS-позиція" : "Очікуємо геолокацію"}
          />
          <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16 }}>
            <div style={{ fontWeight: 950, fontSize: 20 }}>{hasLiveGps ? "Навігація за GPS" : "Немає GPS"}</div>
            <div style={{ color: "#CBD5E1", marginTop: 6, fontWeight: 700 }}>Клієнт: {customerLabel}</div>
            <div style={{ color: "#CBD5E1", marginTop: 8, fontWeight: 700, lineHeight: 1.4 }}>
              {hasLiveGps
                ? "Позиція оновлюється з вашого пристрою. Імітацію руху вимкнено."
                : "Увімкніть геолокацію, щоб бачити себе на карті. Рух не імітується."}
            </div>
          </div>
        </div>
      </ScreenLayout>
    )
  }

  if (step === "offer" && activeOffer) {
    return (
      <>
      <IncomingOfferStep
        offer={activeOffer}
        providerLocation={providerLocation}
        secondsLeft={secondsLeft}
        saving={offerSaving}
        error={offerError}
        proposedPrice={proposedPrice}
        priceNote={priceNote}
        onProposedPriceChange={syncProposedPrice}
        onPriceNoteChange={setPriceNote}
        onAccept={() => acceptOffer(activeOffer)}
        onDecline={() => declineOffer(activeOffer)}
        onAcceptBlocked={handleOfferAcceptBlocked}
      />
      {selectedRequestPin ? (
        <OrderRequestSheet
          pin={selectedRequestPin}
          proposedPrice={sheetProposedPrice}
          saving={offerSaving}
          error={offerError}
          secondsLeft={secondsLeft}
          onProposedPriceChange={syncProposedPrice}
          onAccept={() => void acceptFromSheet()}
          onClose={() => {
            setSelectedRequestPin(undefined)
            setOfferError(undefined)
          }}
          onAcceptBlocked={handleOfferAcceptBlocked}
        />
      ) : null}
      </>
    )
  }

  return (
    <>
    <RideScreen
      pickup={mapRequestPins[0]?.customerCoordinates ?? providerLocation}
      providers={[providerPresence, ...mapProviders]}
      requestPins={mapRequestPins}
      mapSubtitle="Заявки поруч на карті"
      showAllProviders
      onAcceptRequest={acceptFromMapPin}
      onContactRequest={contactFromMapPin}
      onRequestPinSelect={openRequestPin}
    >
      <button onClick={() => setStep("duty")} style={{ border: "none", background: GHOST, color: DARK, borderRadius: 999, padding: "8px 11px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit", marginBottom: 14 }}>← Назад до карти</button>
      <SheetHeading title="Заявки на карті" subtitle={`${mapRequestPins.length} активних · натисніть маркер`} />
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {mapRequestPins.length === 0 ? (
          <div style={{ background: BG, borderRadius: 14, padding: 12, fontWeight: 800, color: MUTED }}>Поки немає заявок у вашому радіусі.</div>
        ) : (
          mapRequestPins.map((pin) => (
            <div key={pin.offerId ?? pin.id} style={{ background: CARD, borderRadius: 18, padding: 14, border: `1px solid ${BORDER}` }}>
              <div style={{ fontWeight: 950, color: DARK }}>{getServiceEmoji(pin.service)} {getProviderCapabilityLabel(pin.service)}</div>
              <div style={{ color: MUTED, fontWeight: 700, marginTop: 4, fontSize: 13 }}>{pin.customerLocation ?? "Поруч"} · {pin.distanceKm?.toFixed(1) ?? "?"} км</div>
              {pin.customerComment ? <div style={{ color: MUTED, fontWeight: 700, marginTop: 6, fontSize: 12, lineHeight: 1.35 }}>{pin.customerComment}</div> : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                <PrimaryButton label="Деталі" onClick={() => openRequestPin(pin)} disabled={offerSaving} />
                <SecondaryButton label="Зв'язатися" onClick={() => contactFromMapPin(pin)} />
              </div>
            </div>
          ))
        )}
        {offerError && offerError !== "Вкажіть вартість послуги в гривнях." ? <div style={{ background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: 12, fontWeight: 850 }}>{offerError}</div> : null}
      </div>
    </RideScreen>
    {selectedRequestPin ? (
      <OrderRequestSheet
        pin={selectedRequestPin}
        proposedPrice={sheetProposedPrice}
        saving={offerSaving}
        error={offerError}
        secondsLeft={secondsLeft}
        onProposedPriceChange={syncProposedPrice}
        onAccept={() => void acceptFromSheet()}
        onClose={() => {
          setSelectedRequestPin(undefined)
          setOfferError(undefined)
        }}
        onAcceptBlocked={handleOfferAcceptBlocked}
      />
    ) : null}
    </>
  )
}

function normalizeOrderStatus(status?: string): OrderStatus {
  if (status === "searching" || status === "accepted" || status === "price_confirmed" || status === "assigned" || status === "en_route" || status === "arrived" || status === "in_progress" || status === "completed" || status === "cancelled" || status === "draft") {
    return status
  }
  if (status === "created" || status === "matching") return "searching"
  if (status === "tracking") return "en_route"
  return "draft"
}

function screenForOrderStatus(status: OrderStatus): Screen {
  if (status === "searching") return "searching"
  if (status === "accepted") return "accepted"
  if (status === "price_confirmed" || status === "assigned") return "assigned"
  if (status === "en_route") return "tracking"
  if (status === "arrived") return "arrived"
  if (status === "in_progress") return "in_progress"
  if (status === "completed") return "completed"
  if (status === "cancelled") return "cancelled"
  return "home"
}

export default function CustomerApp() {
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const telegramLoggedOut = telegramContext.isTelegram && isExplicitLogout(telegramContext.chatId)
  const isMobile = useMediaQuery(mediaQueries.mobile)
  const adminToken = useMemo(() => getStoredQueryToken("adminToken", "pomichAdminToken"), [])
  const providerToken = useMemo(() => getStoredQueryToken("providerToken", "pomichProviderToken"), [])
  const initialRole = useMemo<Role | null>(() => {
    if (typeof window === "undefined") return null
    if (isAdminEntryLocation()) return "admin"
    const queryRole = new URLSearchParams(window.location.search).get("role")
    if (queryRole === "customer" || queryRole === "provider") return queryRole
    const entryRole = resolveEntryRole()
    if (entryRole) return entryRole
    return null
  }, [])
  const [role, setRole] = useState<Role | null>(initialRole)
  const [account, setAccount] = useState<UserAccountStatus | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (initialRole === "customer" || initialRole === "provider") return true
    if (telegramContext.isTelegram && initialRole !== "admin" && !providerToken && !telegramLoggedOut) return true
    return false
  })
  const [pendingRole, setPendingRole] = useState<Role | null>(initialRole === "customer" || initialRole === "provider" ? initialRole : null)
  const [startAtRoleSelect, setStartAtRoleSelect] = useState(false)
  const [loginMode, setLoginMode] = useState(() => {
    if (telegramContext.isTelegram && initialRole !== "admin" && !providerToken && !telegramLoggedOut) return true
    return false
  })
  const [showLanding, setShowLanding] = useState(() => telegramLoggedOut)
  const [showCabinet, setShowCabinet] = useState(false)
  const [customerToken, setCustomerToken] = useState<string | undefined>()
  const [forceRolePicker, setForceRolePicker] = useState(false)
  const [rolePickerKey, setRolePickerKey] = useState(0)
  const compact = telegramContext.isTelegram || isMobile
  const skipOnboarding = initialRole === "admin" || Boolean(providerToken)

  const applyRoleToUrl = useCallback((nextRole: Role | null) => {
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
  }, [])

  const beginOnboarding = useCallback((nextRole: Role | null, openRolePicker = false, isLogin = false) => {
    if (skipOnboarding && nextRole) {
      applyRoleToUrl(nextRole)
      return
    }
    clearExplicitLogout()
    // Login must keep a valid stored customer session (menu/landing → «Увійти»).
    // Only purge tokens for other customer ids — never wipe the active session here.
    if (isLogin) {
      const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
      purgeStaleCustomerSessions(activeCustomerId)
    }
    setPendingRole(nextRole)
    setStartAtRoleSelect(openRolePicker)
    setLoginMode(isLogin)
    setShowOnboarding(true)
    setShowLanding(false)
    setShowCabinet(false)
  }, [skipOnboarding, telegramContext.chatId, applyRoleToUrl])

  const enterCustomerFlow = useCallback(async () => {
    clearExplicitLogout()
    setAccount(null)
    setCustomerToken(undefined)

    // Do not clearCustomerAuthStorage here — returning users keep token/customerId across Меню/landing.
    const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
    purgeStaleCustomerSessions(activeCustomerId)

    try {
      const resolved = await resolveCustomerAuthSession(telegramContext, { explicitSignIn: true })
      const status = resolved.account ?? mergeAccountProfile(
        await getUserAccount(resolved.customerId, resolved.token, telegramContext.initData),
        resolved.profile,
      )
      // Web guest-* sessions are valid returning clients when registered/complete (phone OTP already done).
      const canonicalSession =
        resolved.customerId.startsWith("tg-") ||
        resolved.customerId.startsWith("guest-") ||
        (status.clientRegistered && resolved.customerId !== "customer-web")

      if (canonicalSession && isReturningClient(status)) {
        if (status.profile && isCustomerProfileComplete(status.profile) && !isCustomerVerified(status.profile)) {
          beginOnboarding("customer", false, true)
          return
        }
        setAccount(status)
        setCustomerToken(resolved.token)
        if (status.profile && typeof window !== "undefined") {
          window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(status.profile))
        }
        setShowOnboarding(false)
        setShowLanding(false)
        setShowCabinet(false)
        setPendingRole(null)
        setStartAtRoleSelect(false)
        setLoginMode(false)
        applyRoleToUrl("customer")
        return
      }
    } catch {
      // Fall through to phone login when account cannot be restored.
    }

    beginOnboarding("customer", false, true)
  }, [beginOnboarding, applyRoleToUrl, telegramContext])

  const enterPartnerFlow = useCallback(() => {
    clearExplicitLogout()
    clearProviderAuthStorage({ includeAdmin: true })
    setAccount(null)
    setCustomerToken(undefined)
    setRole(null)
    setShowCabinet(false)
    // Keep customer token/customerId — only «Вийти» wipes them. Phone OTP still runs when
    // there is no restorable registered partner session (OnboardingGate loginMode).
    beginOnboarding("provider", false, true)
  }, [beginOnboarding])

  /** phone_already_registered / «Увійти за цим номером» — same as landing partner re-entry. */
  const restorePartnerAccount = useCallback(() => {
    enterPartnerFlow()
  }, [enterPartnerFlow])

  const goToLanding = useCallback(() => {
    // «Меню» / logo / home — show landing but keep customer token + customerId in storage.
    setShowLanding(true)
    setShowOnboarding(false)
    setShowCabinet(false)
    setForceRolePicker(false)
    setPendingRole(null)
    setStartAtRoleSelect(false)
    setLoginMode(false)
    applyRoleToUrl(null)
  }, [applyRoleToUrl])

  const handleRoleChange = useCallback((nextRole: Role | null) => {
    if (nextRole === "customer") {
      void enterCustomerFlow()
      return
    }
    if (nextRole === "provider") {
      void enterPartnerFlow()
      return
    }
    goToLanding()
  }, [enterCustomerFlow, enterPartnerFlow, goToLanding])
  const handleLogout = () => {
    // Block Telegram auto-relogin AND web session restore after explicit logout.
    markExplicitLogout(telegramContext.isTelegram ? telegramContext.chatId : undefined)
    // Always leave the ride first — logout must work from completion/review screens.
    clearActiveOrder()
    clearAllAuthStorage()
    setCustomerToken(undefined)
    setAccount(null)
    setForceRolePicker(false)
    setPendingRole(null)
    setStartAtRoleSelect(false)
    setLoginMode(false)
    setShowOnboarding(false)
    setShowCabinet(false)
    setShowLanding(true)
    setRole(null)

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.delete("role")
      url.searchParams.delete("providerToken")
      url.searchParams.delete("adminToken")
      // Cache-bust so same-path assign always hard-reloads off the completion screen.
      url.searchParams.set("logged_out", String(Date.now()))
      window.location.replace(`${url.pathname}${url.search}${url.hash}`)
    }
  }

  const handleSwitchRole = () => {
    // Keep the same customer identity + linkedProviderId so a registered partner
    // profile is restored after picking «Партнер» again (logout is the only full wipe).
    clearProviderAuthStorage({ includeAdmin: true })
    if (typeof window !== "undefined") {
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
    setLoginMode(false)
    setRole(null)
  }

  const loggedInCustomerName = useMemo(() => {
    if (role !== "customer" || showLanding || showOnboarding) return undefined
    const activeCustomerId = readPersistedCustomerId(telegramContext.chatId)
    const token =
      customerToken ??
      readStoredAuthSession(authSessionStorageKey("customer", activeCustomerId), "customer", activeCustomerId)
    if (!token) return undefined
    const name = (account?.profile?.name ?? "").trim()
    if (!name || name === DEFAULT_CUSTOMER_NAME) return undefined
    return name
  }, [role, showLanding, showOnboarding, customerToken, account?.profile?.name, telegramContext.chatId])

  useEffect(() => {
    if (typeof window === "undefined") return
    const enterAdminFromLocation = () => {
      if (!isAdminEntryLocation()) return false
      setRole("admin")
      setShowLanding(false)
      setShowOnboarding(false)
      if (isHiddenAdminHash()) applyHiddenAdminEntry()
      return true
    }

    enterAdminFromLocation()
    window.addEventListener("hashchange", enterAdminFromLocation)
    return () => window.removeEventListener("hashchange", enterAdminFromLocation)
  }, [])

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
      if (isAdminEntryLocation()) {
        setRole("admin")
        setShowLanding(false)
        setShowOnboarding(false)
        if (isHiddenAdminHash()) applyHiddenAdminEntry()
        return
      }
      const queryRole = new URLSearchParams(window.location.search).get("role")
      if (queryRole === "customer" || queryRole === "provider") {
        setRole(queryRole)
        return
      }
      setRole(null)
    }

    window.addEventListener("popstate", syncRoleFromUrl)
    return () => window.removeEventListener("popstate", syncRoleFromUrl)
  }, [])

  useEffect(() => {
    if (!showCabinet || role !== "customer" || !account?.customerId) return

    let cancelled = false
    resolveCustomerAuthSession(telegramContext)
      .then((resolved) => {
        if (cancelled) return
        if (resolved.account) {
          setAccount(resolved.account)
        } else {
          setAccount((prev) => (prev ? { ...prev, customerId: resolved.customerId, profile: resolved.profile ?? prev.profile } : prev))
        }
        setCustomerToken(resolved.token)
        if (resolved.profile && typeof window !== "undefined") {
          window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(resolved.profile))
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [showCabinet, role, account?.customerId, telegramContext])

  useEffect(() => {
    if (!showCabinet || role !== "customer" || !account?.customerId || !customerToken) return
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return

    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (cancelled) return
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        syncProfileCityFromGeo(point, account.customerId, customerToken, account.profile?.city)
          .then((result) => {
            if (cancelled || !result) return
            setAccount((prev) => {
              if (!prev?.profile) return prev
              const profile = result.saved ?? { ...prev.profile, city: result.city }
              if (typeof window !== "undefined") {
                window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(profile))
              }
              return { ...prev, profile }
            })
          })
          .catch(() => undefined)
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 12000 },
    )

    return () => {
      cancelled = true
    }
  }, [showCabinet, role, account?.customerId, account?.profile?.city, customerToken])

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
        onLogout={handleLogout}
        onReady={({ role: readyRole, account: readyAccount, customerToken: readyToken }) => {
          setAccount(readyAccount)
          setCustomerToken(readyToken)
          if (readyAccount.linkedProviderId) storeLinkedProviderId(readyAccount.linkedProviderId)
          if (readyAccount.profile && typeof window !== "undefined") {
            window.sessionStorage.setItem("pomichBootstrapProfile", JSON.stringify(readyAccount.profile))
          }
          setForceRolePicker(false)
          setShowOnboarding(false)
          setStartAtRoleSelect(false)
          setLoginMode(false)
          setPendingRole(null)
          applyRoleToUrl(readyRole)
        }}
      />
    )
  }

  if (showCabinet && account?.profile && role === "customer") {
    // Prefer the authenticated account id (orders are keyed by session subject), not a forced tg-* override.
    const cabinetCustomerId =
      account.customerId ||
      (telegramContext.chatId ? `tg-${telegramContext.chatId}` : "") ||
      readPersistedCustomerId(telegramContext.chatId)
    const cabinetProfile = enrichProfileWithTelegram(account.profile, telegramContext, cabinetCustomerId)
    const cabinetCustomerToken =
      customerToken ??
      (typeof window !== "undefined"
        ? readStoredAuthSession(authSessionStorageKey("customer", cabinetCustomerId), "customer", cabinetCustomerId)
        : undefined)
    const sessionMismatchWarning = resolveSessionMismatchWarning(cabinetCustomerId, telegramContext.chatId)
    return (
      <ClientCabinet
        profile={cabinetProfile}
        customerId={cabinetCustomerId}
        customerToken={cabinetCustomerToken}
        currentRole="customer"
        sessionMismatchWarning={sessionMismatchWarning}
        onDismissSessionMismatch={() => dismissSessionMismatchNotice(cabinetCustomerId)}
        onBack={() => setShowCabinet(false)}
        onStartOrder={() => {
          setShowCabinet(false)
          void enterCustomerFlow()
        }}
        onSwitchRole={handleSwitchRole}
        onLogout={handleLogout}
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
    const cabinetProviderId = getActiveProviderId()
    const cabinetProviderToken =
      providerToken ??
      (typeof window !== "undefined"
        ? readStoredAuthSession(authSessionStorageKey("provider", cabinetProviderId), "provider", cabinetProviderId)
        : undefined)
    return (
      <ProviderCabinet
        providerId={cabinetProviderId}
        providerToken={cabinetProviderToken}
        currentRole="provider"
        onBack={() => setShowCabinet(false)}
        onSwitchRole={handleSwitchRole}
        onLogout={handleLogout}
      />
    )
  }

  if (role === "admin") {
    return <AdminFlow adminToken={adminToken} />
  }

  return (
    role === null || showLanding ? (
      <LandingPage
        onSelect={(nextRole) => {
          if (nextRole === "customer") {
            void enterCustomerFlow()
            return
          }
          enterPartnerFlow()
        }}
        onRegister={() => beginOnboarding(null, true, false)}
        onLogin={() => void enterCustomerFlow()}
        onHiddenAdmin={() => {
          setRole("admin")
          setShowLanding(false)
          setShowOnboarding(false)
          applyHiddenAdminEntry()
        }}
      />
    ) : (
      <AppShell compact={compact} role={role} loggedInName={loggedInCustomerName} onRoleChange={handleRoleChange} onOpenCabinet={() => setShowCabinet(true)} onSwitchRole={handleSwitchRole} onLogout={handleLogout}>
        {role === "provider" ? (
          <ProviderFlow
            providerToken={providerToken}
            providerRegistered={account?.providerRegistered ?? false}
            onLogout={handleLogout}
            onRestoreAccount={restorePartnerAccount}
          />
        ) : role === "customer" && account && !isReturningClient(account) ? (
          <CustomerAppFallback
            message="Потрібно завершити реєстрацію клієнта."
            onRetry={() => beginOnboarding("customer", false, true)}
            onLanding={() => {
              goToLanding()
            }}
          />
        ) : (
          <CustomerFlow onLogout={handleLogout} />
        )}
      </AppShell>
    )
  )
}
