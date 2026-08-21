import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  acceptProviderOffer,
  createProviderAccountSession,
  createProviderSession,
  createSelfProviderSession,
  declineProviderOffer,
  getCustomerProfile,
  getOrder,
  getProviderOffers,
  getProviderOrders,
  getProviderProfile,
  getProviders,
  getNearbyMapOrders,
  messageFromFetchError,
  retryDispatch,
  setUserPreferredRole,
  submitOrderReview,
  updateProviderOrderStatus,
  updateProviderPresence,
  updateProviderProfile,
  ApiRequestError,
  type AuthSession,
  type CustomerProfile,
  type DispatchOffer,
  type MapRequestPin,
  type OrderResponse,
  type ProviderAvailability,
  type VerificationStatus,
} from "../../api/client"
import LazyRouteMap from "../map/LazyRouteMap"
import { RideScreen } from "../layout/RideScreen"
import {
  DEFAULT_SERVICE_RADIUS_KM,
  PROVIDER_START,
  services,
  provider,
  partnerRegistrationServices,
  getActiveProviderId,
  getServiceEmoji,
  getProviderCapabilityLabel,
  toServiceKeys,
  composePartnerVehicle,
  emptyPartnerRegistrationForm,
  hydratePartnerVehicleFromProfile,
  isProviderPhoneVerified,
  partnerVehicleSelectionIsComplete,
  providerPoint,
  resolvePartnerVehicleMake,
  orderStatusLabels,
  verificationLabel,
  verificationTone,
  type PartnerRegistrationForm,
  type Point,
  type OrderStatus,
} from "../../lib/constants"
import { readBootstrapProfile, resolveProviderIdForCustomer, storeLinkedProviderId } from "../../lib/userAccount"
import { readCachedProviderProfile, writeCachedProviderProfile } from "../../lib/providerProfileCache"
import { clearActiveOrder, isActiveOrderStatus, persistActiveOrder, pickLatestActiveOrder, readActiveOrder } from "../../lib/customerSession"
import { clearPendingPartnerReview, persistPendingPartnerReview, readPendingPartnerReview } from "../../lib/appRole"
import { requestCurrentPosition } from "../../lib/mapGeo"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { validateUkrainePlate } from "../../lib/ukrainePlate"
import { isPartnerProfileComplete } from "../../lib/partnerProfileComplete"
import { validatePersonName } from "../../lib/personName"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
import { PhoneInput } from "../ui/PhoneInput"
import { UkrainePlateInput } from "../ui/UkrainePlateInput"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { CitySelect } from "../ui/CitySelect"
import { FieldError } from "../ui/FieldError"
import {
  authSessionStorageKey,
  isAuthSessionToken,
  readAuthSessionSubject,
  readPersistedCustomerId,
  readStoredAuthSession,
  readStoredCustomerAuthSession,
  storeAuthSession,
} from "../../lib/auth"
import { isCustomerVerified } from "../../lib/customerProfile"
import { OrderFinalStep } from "../customer/OrderTerminalStep"
import { DutyStatusToggle, PresenceToast, presenceErrorMessage } from "../ui/DutyStatusToggle"
import { OrderRequestSheet } from "./OrderRequestSheet"
import { IncomingOfferStep } from "./IncomingOfferStep"
import { filterActiveMapRequestPins, filterActiveOffers, filterVisibleOffers, formatCountdown, acceptedIdleSecondsLeft, isOfferActive, isPresentableOffer, mergeRequestPins, offerActionErrorMessage, offerSecondsLeft, parseOfferPrice, pinFromOffer, readPersistedOfferDismissals, writePersistedOfferDismissals } from "../../lib/dispatchOffer"
import { subscribeOrderEvents, subscribeProviderEvents } from "../../lib/realtime"
import { getTelegramContext } from "../../telegram"
import { useScreenWakeLock } from "../../hooks/useScreenWakeLock"
import {
  alertPartnerNewRequest,
  diffNewIds,
  ensurePartnerAlertPermission,
} from "../../lib/partnerDutyAlerts"
import FormContainer, { FormFooterBar, FormHeader } from "../layout/FormContainer"
import { AccountLoginStep } from "../views/AccountLoginStep"
import { ProviderRegistrationStep } from "../views/ProviderRegistrationStep"
import { ServiceRadiusField } from "../ui/ServiceRadiusField"
import { PartnerVehicleFields } from "./PartnerVehicleFields"
import { normalizeOrderStatus } from "../../lib/orderStatus"
import type { ServiceKey } from "../../lib/pomichDomain"
import { ThemeToggle } from "../ui/ThemeToggle"
import type { MapTileTheme } from "../../lib/theme"

function VerificationPill({ status }: { status?: VerificationStatus }) {
  const tone = verificationTone(status)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "5px 9px", background: tone.background, color: tone.color, border: `1px solid ${tone.border}`, fontSize: 11, fontWeight: 900 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor" }} />
      {verificationLabel(status)}
    </span>
  )
}

function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 950, color: DARK, letterSpacing: "-0.03em" }}>{title}</div>
      {subtitle ? <div style={{ marginTop: 6, color: MUTED, fontWeight: 700, fontSize: 13, lineHeight: 1.35 }}>{subtitle}</div> : null}
    </div>
  )
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

function resolveSessionProviderId(session: { providerId?: string; subjectId?: string }, fallback: string) {
  return String(session.providerId || session.subjectId || fallback).trim() || fallback
}

function PrimaryButton({
  label,
  onClick,
  loading = false,
  disabled = false,
  loadingLabel = "Зачекайте…",
}: {
  label: string
  onClick?: () => void
  loading?: boolean
  disabled?: boolean
  loadingLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`pomich-primary-btn${disabled || loading ? " is-disabled" : ""}`}
    >
      {loading ? loadingLabel : label}
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

function ScreenLayout({ children, footer, className = "" }: { children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={`pomich-themed-shell pomich-screen-layout ${className}`.trim()} style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: "100%", minHeight: "100%", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
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


export default function ProviderFlow({
  providerToken,
  providerRegistered = false,
  initialScreen,
  onLogout,
  onRestoreAccount,
}: {
  providerToken?: string
  providerRegistered?: boolean
  /** Deep link from Telegram bot buttons: duty / offers / verify. */
  initialScreen?: "duty" | "offers" | "verify"
  onLogout?: () => void
  onRestoreAccount?: () => void
}) {
  const mapTileTheme: MapTileTheme = "light"
  const [providerId, setProviderId] = useState(() => getActiveProviderId())
  const partnerRegisteredFromStorage =
    typeof window !== "undefined" &&
    Boolean(window.localStorage.getItem(`pomichPartnerRegistered:${providerId}`))
  const rawLinkedPartnerId =
    typeof window !== "undefined" ? window.sessionStorage.getItem("pomichLinkedProviderId") : ""
  const linkedPartnerId = providerRegistered === false ? "" : rawLinkedPartnerId
  const effectiveProviderRegistered = providerRegistered || partnerRegisteredFromStorage
  const providerSessionStorageKey = useMemo(() => authSessionStorageKey("provider", providerId), [providerId])
  const [providerAccessToken, setProviderAccessToken] = useState<string | undefined>(() => {
    if (isAuthSessionToken(providerToken)) return providerToken
    return readStoredAuthSession(authSessionStorageKey("provider", getActiveProviderId()), "provider", getActiveProviderId())
  })
  const providerAuthToken = providerAccessToken
  const [authError, setAuthError] = useState<string | undefined>()
  const [entryScreenApplied, setEntryScreenApplied] = useState(false)

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
  const [loginView, setLoginView] = useState<"login" | "register">(() => (effectiveProviderRegistered ? "login" : "register"))
  const persistedActiveOrder = typeof window !== "undefined" ? readActiveOrder() : undefined
  const [step, setStep] = useState<"register" | "verify" | "duty" | "offer" | "awaiting_price" | "navigation" | "arrived" | "completed">(() => {
    if (typeof window === "undefined") return "register"
    if (initialScreen === "verify") return "verify"
    if (persistedActiveOrder?.orderId) {
      const status = normalizeOrderStatus(persistedActiveOrder.status)
      if (status === "accepted") return "awaiting_price"
      if (status === "arrived" || status === "in_progress") return "arrived"
      if (status === "completed") return "completed"
      if (status !== "searching" && status !== "cancelled") return "navigation"
    }
    if (effectiveProviderRegistered || window.localStorage.getItem(`pomichPartnerRegistered:${getActiveProviderId()}`) || Boolean(linkedPartnerId)) return "duty"
    return "register"
  })
  const [dutySheetSnap, setDutySheetSnap] = useState<"half" | "expanded">(() =>
    initialScreen === "offers" ? "expanded" : "half",
  )
  const [onDuty, setOnDuty] = useState(false)
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [presenceToast, setPresenceToast] = useState<string | undefined>()
  const [registrationSaving, setRegistrationSaving] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | undefined>()
  const [incomingOffers, setIncomingOffers] = useState<DispatchOffer[]>([])
  const [nearbyRequestPins, setNearbyRequestPins] = useState<MapRequestPin[]>([])
  const [mapRequestPins, setMapRequestPins] = useState<MapRequestPin[]>([])
  const [selectedRequestPin, setSelectedRequestPin] = useState<MapRequestPin | undefined>()
  const [sheetProposedPrice, setSheetProposedPrice] = useState("")
  const [activeOrder, setActiveOrder] = useState<OrderResponse | undefined>(() => {
    if (!persistedActiveOrder?.orderId) return undefined
    return {
      id: persistedActiveOrder.orderId,
      status: normalizeOrderStatus(persistedActiveOrder.status),
    } as OrderResponse
  })
  const [offerError, setOfferError] = useState<string | undefined>()
  const [offerSaving, setOfferSaving] = useState(false)
  const [orderAdvancing, setOrderAdvancing] = useState(false)
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
  const dismissedOfferIdsRef = useRef<Set<string>>(new Set())
  const dismissedOrderIdsRef = useRef<Set<string>>(new Set())

  const rememberDismissedOffer = useCallback((offerId?: string, orderId?: string) => {
    if (offerId) dismissedOfferIdsRef.current.add(offerId)
    if (orderId) dismissedOrderIdsRef.current.add(orderId)
    writePersistedOfferDismissals(providerId, dismissedOfferIdsRef.current, dismissedOrderIdsRef.current)
  }, [providerId])

  useEffect(() => {
    const persisted = readPersistedOfferDismissals(providerId)
    dismissedOfferIdsRef.current = new Set(persisted.offerIds)
    dismissedOrderIdsRef.current = new Set(persisted.orderIds)
  }, [providerId])
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
  const telegramContext = useMemo(() => getTelegramContext(), [])
  useScreenWakeLock(onDuty)
  const seenDutyAlertIdsRef = useRef<Set<string>>(new Set())
  const dutyAlertsSeededRef = useRef(false)
  const otpBotUsername = telegramContext.botKind === "provider" ? "pomich_help_bot" : "pomich_ua_bot"
  const customerAuthSession = useMemo(
    () => (typeof window !== "undefined" ? readStoredCustomerAuthSession({ telegramChatId: telegramContext.chatId }) : undefined),
    [telegramContext.chatId],
  )
  const customerIdForOtp =
    customerAuthSession?.customerId ??
    (typeof window !== "undefined" ? readPersistedCustomerId(telegramContext.chatId) : null)
  const customerTokenForOtp =
    customerAuthSession?.token ??
    (customerIdForOtp
      ? readStoredAuthSession(authSessionStorageKey("customer", customerIdForOtp), "customer", customerIdForOtp)
      : undefined)
  const [customerOtpProfile, setCustomerOtpProfile] = useState<CustomerProfile | undefined>()
  const isPartnerRegisteredAndCompleted = isPartnerProfileComplete(
    {
      name: providerProfile.name || registrationForm.name,
      phone: providerProfile.phone || registrationForm.phone,
      plate: providerProfile.plate || registrationForm.plate,
      specialties: providerProfile.specialties?.length ? providerProfile.specialties : registrationForm.specialties,
      vehicle:
        String(providerProfile.vehicle || "").trim() ||
        (partnerVehicleSelectionIsComplete(registrationForm.vehicleMake, registrationForm.vehicleMakeOther, registrationForm.vehicleModel)
          ? registrationForm.vehicle || `${registrationForm.vehicleMake} ${registrationForm.vehicleModel}`.trim()
          : ""),
      registeredAt: providerProfile.registeredAt,
    },
    { treatAsRegistered: effectiveProviderRegistered },
  )
  const providerCanGoOnline =
    isPartnerRegisteredAndCompleted &&
    (isProviderPhoneVerified(providerProfile) || Boolean(customerOtpProfile && isCustomerVerified(customerOtpProfile)))
  const dutyAutoAttemptedRef = useRef(false)
  /** User opened «Завершити профіль» / incomplete go-online gate — hydrate must not bounce away. */
  const profileGateOpenRef = useRef(false)

  const markProviderPhoneVerified = useCallback((currentProvider?: ProviderAvailability) => {
    setProviderProfile((profile) => {
      const specialties = toServiceKeys(currentProvider?.specialties ?? profile.specialties)
      const merged: ProviderAvailability = {
        ...profile,
        ...(currentProvider ?? {}),
        specialties: specialties.length > 0 ? specialties : profile.specialties,
        verificationStatus: "verified",
        verification: { ...(currentProvider?.verification ?? profile.verification), phone: true },
        registeredAt: currentProvider?.registeredAt || profile.registeredAt,
      }
      writeCachedProviderProfile({ ...merged, id: providerId })
      return merged
    })
  }, [providerId])

  const mergeRegistrationFormFromSources = useCallback((
    sources: Array<Partial<ProviderAvailability> | CustomerProfile | undefined | null>,
    options?: { overwrite?: boolean },
  ) => {
    const overwrite = Boolean(options?.overwrite)
    setRegistrationForm((form) => {
      let next = { ...form }
      for (const source of sources) {
        if (!source) continue
        const vehicleFields = hydratePartnerVehicleFromProfile(source as { vehicle?: string; vehicleMake?: string; vehicleModel?: string })
        const specialties = toServiceKeys((source as ProviderAvailability).specialties)
        const city = String((source as { city?: string }).city || "").trim()
        const pick = (current: string, incoming: string) => {
          const value = incoming.trim()
          if (overwrite && value) return value
          return current.trim() || value
        }
        const currentCity = next.city.trim()
        const cityIsPlaceholder = !currentCity || currentCity === DEFAULT_SERVICE_CITY
        next = {
          ...next,
          name: pick(next.name, String(source.name || "")),
          phone: pick(next.phone, String(source.phone || "")),
          telegram: pick(next.telegram, String((source as ProviderAvailability).telegram || "")),
          vehicleMake: pick(next.vehicleMake, vehicleFields.vehicleMake || ""),
          vehicleMakeOther: pick(next.vehicleMakeOther, vehicleFields.vehicleMakeOther || ""),
          vehicleModel: pick(next.vehicleModel, vehicleFields.vehicleModel || ""),
          vehicle: pick(next.vehicle, vehicleFields.vehicle || ""),
          plate: pick(next.plate, String((source as ProviderAvailability).plate || "")),
          city: overwrite && city ? city : cityIsPlaceholder && city ? city : currentCity || city || next.city,
          specialties: overwrite && specialties.length > 0
            ? specialties
            : next.specialties.length > 0
              ? next.specialties
              : specialties,
          serviceRadiusKm: overwrite
            ? ((source as ProviderAvailability).serviceRadiusKm ?? next.serviceRadiusKm)
            : next.serviceRadiusKm || (source as ProviderAvailability).serviceRadiusKm || next.serviceRadiusKm,
        }
      }
      return next
    })
  }, [])

  const applyLoadedProvider = useCallback((currentProvider: ProviderAvailability) => {
    const currentSpecialties = toServiceKeys(currentProvider.specialties)
    setProviderProfile((profile) => {
      const merged = {
        ...profile,
        ...currentProvider,
        specialties: currentSpecialties.length > 0 ? currentSpecialties : profile.specialties,
        // Keep a previously cached registeredAt when API returns an empty linked shell.
        registeredAt: currentProvider.registeredAt || profile.registeredAt,
      }
      writeCachedProviderProfile({ ...merged, id: currentProvider.id || providerId })
      return merged
    })
    if (typeof window !== "undefined" && (currentProvider.registeredAt || currentProvider.vehicle || currentProvider.plate)) {
      window.localStorage.setItem(`pomichPartnerRegistered:${currentProvider.id || providerId}`, "1")
      window.localStorage.setItem(`pomichPartnerRegistered:${getActiveProviderId()}`, "1")
    }
    // Always prefill (including empty shells without registeredAt) so role switch is not blank.
    mergeRegistrationFormFromSources([currentProvider], { overwrite: Boolean(currentProvider.registeredAt) })
    setOnDuty(currentProvider.status === "online" || currentProvider.status === "busy")
    if (currentProvider.location) setProviderLocation(currentProvider.location)
  }, [providerId, mergeRegistrationFormFromSources])

  const loadCurrentProvider = useCallback(async (): Promise<ProviderAvailability | undefined> => {
    if (providerAuthToken) {
      try {
        const profile = await getProviderProfile(providerId, providerAuthToken)
        if (profile?.id) return profile
      } catch {
        return undefined
      }
      return undefined
    }
    try {
      const providers = await getProviders()
      return Array.isArray(providers) ? providers.find((item) => item.id === providerId) : undefined
    } catch {
      return undefined
    }
  }, [providerAuthToken, providerId])

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
        if (!cancelled && effectiveProviderRegistered) {
          setAuthError("Партнерська сесія не відкрита. Увійдіть з логіном і паролем або зверніться до диспетчера.")
        }
      })

    return () => {
      cancelled = true
    }
  }, [customerIdForOtp, customerTokenForOtp, providerAuthToken, providerId, effectiveProviderRegistered, providerToken])

  useEffect(() => {
    if (step !== "verify" || !customerIdForOtp || !customerTokenForOtp) return
    let cancelled = false

    const loadCustomerForOtp = async () => {
      try {
        const profile = await getCustomerProfile(customerIdForOtp, customerTokenForOtp)
        if (cancelled) return
        setCustomerOtpProfile(profile)
        if (!isCustomerVerified(profile)) return
        const currentProvider = await loadCurrentProvider()
        if (cancelled) return
        markProviderPhoneVerified(currentProvider)
        setStep("duty")
      } catch {
        // OTP panel still usable if profile fetch fails.
      }
    }

    void loadCustomerForOtp()
    return () => {
      cancelled = true
    }
  }, [step, customerIdForOtp, customerTokenForOtp, loadCurrentProvider, markProviderPhoneVerified])

  useEffect(() => {
    let cancelled = false

    const hydrateProvider = async () => {
      try {
        const cached = readCachedProviderProfile(providerId)
        const currentProvider = await loadCurrentProvider()
        if (cancelled) return

        // API empty shell (no registeredAt) for a linked partner: restore from session cache when possible.
        const resolved =
          currentProvider && currentProvider.registeredAt
            ? currentProvider
            : cached?.registeredAt
              ? { ...cached, ...(currentProvider || {}), registeredAt: cached.registeredAt, id: providerId }
              : currentProvider

        if (resolved) {
          applyLoadedProvider(resolved)
        } else if (cached) {
          applyLoadedProvider(cached)
        }

        const registered = Boolean(resolved?.registeredAt || cached?.registeredAt)
        const hydratedProfile: Partial<ProviderAvailability> = resolved || cached || {}
        const hydratedComplete = isPartnerProfileComplete(
          {
            name: hydratedProfile.name,
            phone: hydratedProfile.phone,
            plate: hydratedProfile.plate,
            specialties: hydratedProfile.specialties,
            vehicle: hydratedProfile.vehicle,
            registeredAt: hydratedProfile.registeredAt,
          },
          { treatAsRegistered: effectiveProviderRegistered || Boolean(linkedPartnerId) },
        )
        setStep((current) => {
          if (current !== "register" && current !== "verify" && current !== "duty") return current
          // Preserve intentional profile/OTP gates opened this session (e.g. «Завершити профіль»).
          if (current === "register" && profileGateOpenRef.current && !hydratedComplete) return "register"
          if (current === "verify" && profileGateOpenRef.current && !isProviderPhoneVerified(hydratedProfile)) {
            return "verify"
          }
          // Returning / linked partners stay on duty; go-online opens prefilled completion if needed.
          // Only first-time partners without a linked account are forced into blank registration.
          if (!registered && !effectiveProviderRegistered && !linkedPartnerId) return "register"
          if (registered && isProviderPhoneVerified(hydratedProfile)) {
            return current === "register" || current === "verify" ? "duty" : current
          }
          if (registered || effectiveProviderRegistered || linkedPartnerId) {
            return current === "register" ? "duty" : current
          }
          return current
        })
      } catch {
        // Demo mode stays usable even when the backend is temporarily unavailable.
      }
    }

    void hydrateProvider()
    return () => {
      cancelled = true
    }
  }, [providerId, loadCurrentProvider, applyLoadedProvider, effectiveProviderRegistered, linkedPartnerId])

  // Prefill partner form from the signed-in customer (role switch / missing provider SQL row).
  useEffect(() => {
    let cancelled = false
    const bootstrap = readBootstrapProfile()
    if (bootstrap) mergeRegistrationFormFromSources([bootstrap])

    if (!customerIdForOtp || !customerTokenForOtp) return
    getCustomerProfile(customerIdForOtp, customerTokenForOtp)
      .then((profile) => {
        if (cancelled || !profile) return
        setCustomerOtpProfile(profile)
        mergeRegistrationFormFromSources([profile])
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [customerIdForOtp, customerTokenForOtp, mergeRegistrationFormFromSources])

  useEffect(() => {
    if (step !== "verify" || !providerCanGoOnline) return
    markProviderPhoneVerified()
    setStep("duty")
  }, [step, providerCanGoOnline, markProviderPhoneVerified])

  // Deep link from Telegram «Вийти на лінію» / «Активні офери» / «Підтвердити профіль».
  useEffect(() => {
    if (entryScreenApplied || !providerAuthToken || !initialScreen) return
    if (initialScreen === "verify") {
      setStep(providerProfile.registeredAt || effectiveProviderRegistered ? "verify" : "register")
    } else {
      setStep("duty")
      if (initialScreen === "offers") setDutySheetSnap("expanded")
    }
    setEntryScreenApplied(true)
  }, [
    entryScreenApplied,
    providerAuthToken,
    initialScreen,
    providerProfile.registeredAt,
    effectiveProviderRegistered,
  ])

  useEffect(() => {
    if (!providerId || !providerProfile.name?.trim()) return
    writeCachedProviderProfile({
      ...providerProfile,
      id: providerId,
    })
  }, [
    providerId,
    providerProfile.name,
    providerProfile.phone,
    providerProfile.city,
    providerProfile.vehicle,
    providerProfile.plate,
    providerProfile.status,
    providerProfile.verificationStatus,
    providerProfile.specialties,
    providerProfile.serviceRadiusKm,
  ])

  const providerLocationRef = useRef(providerLocation)
  useEffect(() => {
    providerLocationRef.current = providerLocation
  }, [providerLocation])

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
      // Keep presence alive even with the screen off — otherwise partners drop offline
      // and miss Telegram / map alerts while "На лінії".
      const presenceId = readAuthSessionSubject(providerAuthToken) || providerId
      const assigned = Boolean(providerProfile.assignedOrderId || activeOrder?.id)
      updateProviderPresence(presenceId, {
        status: assigned ? "busy" : "online",
        location: providerLocationRef.current,
        etaMinutes: providerProfile.etaMinutes ?? provider.etaMinutes,
      }, providerAuthToken).catch(() => undefined)
    }

    heartbeat()
    const interval = window.setInterval(heartbeat, 12000)
    return () => window.clearInterval(interval)
  }, [onDuty, providerAuthToken, providerId, providerProfile.etaMinutes, providerProfile.assignedOrderId, activeOrder?.id])

  useEffect(() => {
    const interval = window.setInterval(() => setOfferClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!onDuty || !providerAuthToken || activeOrder || (step !== "duty" && step !== "offer")) return
    let cancelled = false
    const subjectId = readAuthSessionSubject(providerAuthToken) || providerId

    const refreshOffers = () => {
      // Poll while backgrounded so we can fire local notifications; Telegram bot
      // messages still cover fully suspended Mini Apps (esp. iOS).
      getProviderOffers(subjectId, providerAuthToken)
        .then((offers) => {
          if (!cancelled) {
            const activeOffers = filterVisibleOffers(Array.isArray(offers) ? offers : [], {
              dismissedOfferIds: dismissedOfferIdsRef.current,
              dismissedOrderIds: dismissedOrderIdsRef.current,
            })
            setIncomingOffers((prev) => {
              if (
                prev.length === activeOffers.length &&
                prev.every((item, i) => item.id === activeOffers[i]?.id && item.status === activeOffers[i]?.status)
              ) {
                return prev
              }
              return activeOffers
            })
            if (activeOffers.length > 0) setOfferError(undefined)
          }
        })
        .catch(() => {
          if (!cancelled) setIncomingOffers((prev) => (prev.length === 0 ? prev : []))
        })
    }

    refreshOffers()
    let pollMs = 4000
    let interval = window.setInterval(refreshOffers, pollMs)
    const setPollInterval = (ms: number) => {
      pollMs = ms
      window.clearInterval(interval)
      interval = window.setInterval(refreshOffers, pollMs)
    }
    const stopRealtime = subscribeProviderEvents(
      subjectId,
      providerAuthToken,
      () => {
        if (!cancelled) refreshOffers()
      },
      {
        onConnected: () => {
          if (!cancelled) setPollInterval(20000)
        },
        onDisconnected: () => {
          if (!cancelled) setPollInterval(4000)
        },
      },
    )
    return () => {
      cancelled = true
      window.clearInterval(interval)
      stopRealtime()
    }
  }, [activeOrder, onDuty, providerAuthToken, providerId, step])

  useEffect(() => {
    if (!onDuty || !providerAuthToken || activeOrder || (step !== "duty" && step !== "offer")) {
      setNearbyRequestPins((pins) => (pins.length === 0 ? pins : []))
      return
    }
    let cancelled = false
    const radiusKm = providerProfile.serviceRadiusKm ?? registrationForm.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM

    const refreshNearby = () => {
      const loc = providerLocationRef.current
      getNearbyMapOrders(loc.lat, loc.lng, radiusKm, undefined, providerAuthToken)
        .then((orders) => {
          if (cancelled) return
          const visible = filterActiveMapRequestPins(Array.isArray(orders) ? orders : []).filter((pin) => {
            if (dismissedOrderIdsRef.current.has(pin.id)) return false
            if (pin.service && providerSpecialties.length > 0 && !providerSpecialties.includes(pin.service as ServiceKey)) {
              return false
            }
            return true
          })
          setNearbyRequestPins((prev) => {
            if (prev.length === visible.length && prev.every((item, i) => item.id === visible[i]?.id)) {
              return prev
            }
            return visible
          })
        })
        .catch(() => {
          if (!cancelled) setNearbyRequestPins([])
        })
    }

    refreshNearby()
    const interval = window.setInterval(refreshNearby, 8000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [
    activeOrder,
    onDuty,
    providerAuthToken,
    providerProfile.serviceRadiusKm,
    providerSpecialties,
    registrationForm.serviceRadiusKm,
    step,
  ])

  /* Duty map: pins = active offers + nearby searching orders. Expired/closed never stay on the map. */
  useEffect(() => {
    if (!onDuty || (step !== "duty" && step !== "offer")) {
      setMapRequestPins((pins) => (pins.length === 0 ? pins : []))
      return
    }
    const active = filterActiveOffers(incomingOffers, offerClock)
    if (active.length !== incomingOffers.length) {
      setIncomingOffers(active)
      return
    }
    setMapRequestPins((prev) => {
      const next = mergeRequestPins(
        incomingOffers,
        nearbyRequestPins,
        {
          dismissedOfferIds: dismissedOfferIdsRef.current,
          dismissedOrderIds: dismissedOrderIdsRef.current,
        },
        offerClock,
      )
      if (prev.length === next.length && prev.every((p, i) => p.id === next[i]?.id && p.offerId === next[i]?.offerId)) {
        return prev
      }
      return next
    })
  }, [incomingOffers, nearbyRequestPins, offerClock, onDuty, step])

  /* Alert on newly seen offers / nearby requests while on duty (Web Notification + haptic). */
  useEffect(() => {
    if (!onDuty) {
      seenDutyAlertIdsRef.current = new Set()
      dutyAlertsSeededRef.current = false
      return
    }
    // Dedupe by order id so nearby pin + personal offer don't double-fire.
    const nextOrderIds: string[] = []
    const seenNext = new Set<string>()
    const pushOrder = (orderId?: string) => {
      const id = String(orderId || "").trim()
      if (!id || seenNext.has(id)) return
      seenNext.add(id)
      nextOrderIds.push(id)
    }
    for (const offer of incomingOffers) pushOrder(offer.orderId || offer.id)
    for (const pin of nearbyRequestPins) pushOrder(pin.id)

    // Do not lock the seed on the empty post-go-online clear — otherwise the first
    // poll marks every already-open request as "fresh" and spams notifications.
    if (!dutyAlertsSeededRef.current) {
      if (nextOrderIds.length === 0) return
      for (const id of nextOrderIds) seenDutyAlertIdsRef.current.add(id)
      dutyAlertsSeededRef.current = true
      return
    }

    const fresh = diffNewIds(seenDutyAlertIdsRef.current, nextOrderIds)
    for (const orderId of fresh) {
      seenDutyAlertIdsRef.current.add(orderId)
      const offer = incomingOffers.find((item) => item.orderId === orderId || item.id === orderId)
      const pin = nearbyRequestPins.find((item) => item.id === orderId)
      const service = offer?.service || pin?.service
      const serviceMeta = services.find((item) => item.key === service)
      const serviceLabel = service
        ? `${getServiceEmoji(service)} ${serviceMeta?.label || service}`
        : undefined
      const distanceKm = offer?.distanceKm ?? pin?.distanceKm
      alertPartnerNewRequest({
        orderId,
        serviceLabel,
        distanceLabel: typeof distanceKm === "number" ? `${distanceKm.toFixed(1)} км` : undefined,
        webApp: telegramContext.webApp,
      })
    }
  }, [incomingOffers, nearbyRequestPins, onDuty, telegramContext.webApp])

  useEffect(() => {
    if (!onDuty) return
    // Hydrate-online / restore session: ask once when duty becomes true.
    void ensurePartnerAlertPermission()
  }, [onDuty])

  useEffect(() => {
    if (!selectedRequestPin) return
    const stillOpen = mapRequestPins.some(
      (pin) => pin.id === selectedRequestPin.id || (pin.offerId && pin.offerId === selectedRequestPin.offerId),
    )
    if (stillOpen) return
    setSelectedRequestPin(undefined)
    setSheetProposedPrice("")
    if (step === "offer") setStep("duty")
  }, [mapRequestPins, selectedRequestPin, step])

  const activeOffer = incomingOffers.find((offer) => isPresentableOffer(offer, offerClock))
  const selectedOffer = selectedRequestPin
    ? incomingOffers.find((item) => item.id === selectedRequestPin.offerId || item.orderId === selectedRequestPin.id)
    : undefined
  const secondsLeft = offerSecondsLeft(selectedOffer ?? activeOffer, offerClock)

  // Never leave partner UI on offer-without-offer (blank map with no go-online controls).
  useEffect(() => {
    if (step === "offer" && !activeOffer) {
      setStep("duty")
    }
  }, [step, activeOffer])

  useEffect(() => {
    if (!activeOffer) {
      dismissedOfferIdRef.current = undefined
    }
  }, [activeOffer?.id])

  useEffect(() => {
    if (step !== "offer" || !activeOffer || secondsLeft > 0) return
    // Keep the offer visible briefly with an error; do not wipe price-required state onto the empty duty map.
    setOfferError("Пропозиція вже завершилась. Очікуйте нову заявку.")
    setIncomingOffers((offers) => offers.filter((item) => item.id !== activeOffer.id))
    setSelectedRequestPin(undefined)
    setStep("duty")
  }, [activeOffer?.id, secondsLeft, step])

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
  }, [step, activeOffer?.id, selectedRequestPin?.id, offerError])

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
    const parsedPrice = parseOfferPrice(priceSource)
    if (typeof parsedPrice !== "number") {
      setOfferError("Вкажіть вартість послуги в гривнях.")
      return
    }
    const noteForAccept = priceNote.trim() || undefined

    setOfferSaving(true)
    setOfferError(undefined)
    // Optimistic UI: leave the offer/map empty screen before the API returns.
    const optimisticOrder = {
      id: offer.orderId,
      status: "accepted",
      service: offer.service,
      partnerProposedPrice: parsedPrice,
      partnerPriceNote: noteForAccept,
      customerCoordinates: offer.customerCoordinates,
      customerLocation: offer.approximateLocation,
      customerComment: offer.customerComment,
    } as OrderResponse
    persistActiveOrder(offer.orderId, "accepted")
    rememberDismissedOffer(offer.id, offer.orderId)
    setActiveOrder(optimisticOrder)
    setIncomingOffers([])
    setSelectedRequestPin(undefined)
    setSheetProposedPrice("")
    setOnDuty(true)
    setProposedPrice("")
    setPriceNote("")
    setStep("awaiting_price")
    try {
      const session = await ensureProviderSession()
      const result = await acceptProviderOffer(session.providerId, offer.id, session.token, {
        proposedPrice: parsedPrice,
        priceNote: noteForAccept,
      })
      if (result.order?.id) {
        persistActiveOrder(result.order.id, normalizeOrderStatus(result.order.status))
        setActiveOrder(result.order)
        setProviderProfile((profile) => ({ ...profile, status: "busy", assignedOrderId: result.order.id } as ProviderAvailability))
        const nextStatus = normalizeOrderStatus(result.order.status)
        if (nextStatus === "accepted") setStep("awaiting_price")
        else if (nextStatus === "arrived" || nextStatus === "in_progress") setStep("arrived")
        else setStep("navigation")
      }
    } catch (error) {
      const message = offerActionErrorMessage(error, "Не вдалося прийняти заявку. Спробуйте ще раз.")
      setOfferError(message)
      const code = (error as { detail?: { code?: string } }).detail?.code
      clearActiveOrder()
      setActiveOrder(undefined)
      if (code === "OFFER_EXPIRED" || code === "ORDER_ALREADY_ACCEPTED" || code === "OFFER_NOT_FOUND") {
        rememberDismissedOffer(offer.id, offer.orderId)
        setIncomingOffers((offers) => offers.filter((item) => item.id !== offer.id))
        setSelectedRequestPin(undefined)
      }
      setStep("duty")
    } finally {
      setOfferSaving(false)
    }
  }

  const declineOffer = async (offer: DispatchOffer) => {
    setOfferSaving(true)
    setOfferError(undefined)
    dismissedOfferIdRef.current = offer.id
    rememberDismissedOffer(offer.id, offer.orderId)
    setIncomingOffers((offers) => offers.filter((item) => item.id !== offer.id && item.orderId !== offer.orderId))
    setSelectedRequestPin(undefined)
    setStep("duty")
    try {
      const session = await ensureProviderSession()
      await declineProviderOffer(session.providerId, offer.id, session.token)
    } catch (error) {
      const code = (error as { detail?: { code?: string } }).detail?.code
      // Already declined / missing — keep it dismissed locally.
      if (code !== "OFFER_DECLINED" && code !== "OFFER_NOT_FOUND" && code !== "OFFER_EXPIRED") {
        setOfferError(offerActionErrorMessage(error, "Не вдалося пропустити заявку."))
      }
    } finally {
      setOfferSaving(false)
    }
  }

  const openRequestPin = (pin: MapRequestPin) => {
    const matchedOffer = incomingOffers.find((item) => item.id === pin.offerId || item.orderId === pin.id)
    if (matchedOffer && !isPresentableOffer(matchedOffer, offerClock)) {
      setOfferError("Пропозиція вже завершилась. Очікуйте нову заявку.")
      setSelectedRequestPin(undefined)
      setMapRequestPins((pins) => pins.filter((item) => item.id !== pin.id && item.offerId !== pin.offerId))
      return
    }
    setSelectedRequestPin(pin)
    setSheetProposedPrice(proposedPrice)
    setOfferError(undefined)
  }

  const declineFromSheet = async () => {
    if (!selectedRequestPin) return
    const offer = incomingOffers.find((item) => item.id === selectedRequestPin.offerId || item.orderId === selectedRequestPin.id)
    if (offer) {
      await declineOffer(offer)
      return
    }
    rememberDismissedOffer(undefined, selectedRequestPin.id)
    setNearbyRequestPins((pins) => pins.filter((item) => item.id !== selectedRequestPin.id))
    setSelectedRequestPin(undefined)
    setSheetProposedPrice("")
    setOfferError(undefined)
  }

  const acceptFromMapPin = (pin: MapRequestPin) => {
    openRequestPin(pin)
  }

  const acceptFromSheet = async (priceOverride?: string) => {
    if (!selectedRequestPin) return
    const priceSource = priceOverride ?? sheetProposedPrice
    if (priceSource.trim()) {
      setProposedPrice(priceSource)
      setSheetProposedPrice(priceSource)
    }
    let offer = incomingOffers.find((item) => item.id === selectedRequestPin.offerId || item.orderId === selectedRequestPin.id)
    if (!offer) {
      setOfferSaving(true)
      setOfferError(undefined)
      try {
        const session = await ensureProviderSession()
        await retryDispatch(selectedRequestPin.id)
        const offers = await getProviderOffers(session.providerId, session.token)
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
    await acceptOffer(offer, priceSource)
  }

  const contactFromMapPin = (pin: MapRequestPin) => {
    if (pin.phone) {
      window.location.href = `tel:${pin.phone}`
      return
    }
    setOfferError("Телефон клієнта буде доступний після прийняття заявки.")
  }

  const advanceProviderOrder = async (nextStatus: OrderStatus) => {
    if (!activeOrder?.id || orderAdvancing) return
    setOrderAdvancing(true)
    setOfferError(undefined)
    try {
      const session = await ensureProviderSession()
      const resolvedProviderId = resolveSessionProviderId({ providerId: session.providerId }, providerId)
      if (!resolvedProviderId) {
        throw Object.assign(new Error("Сесію партнера не відкрито. Оновіть сторінку або увійдіть знову."), {
          detail: "provider_session_missing",
        })
      }
      const order = await updateProviderOrderStatus(resolvedProviderId, activeOrder.id, nextStatus, session.token)
      const normalizedStatus = normalizeOrderStatus(order.status)
      const orderId = order.id || activeOrder.id
      setActiveOrder(order)
      persistActiveOrder(orderId, normalizedStatus)
      if (normalizedStatus === "completed" || normalizedStatus === "cancelled") {
        rememberDismissedOffer(undefined, orderId)
        setIncomingOffers([])
        clearActiveOrder()
        if (normalizedStatus === "completed") persistPendingPartnerReview(orderId)
        else clearPendingPartnerReview()
        setProviderProfile((profile) => ({ ...profile, status: "online", assignedOrderId: undefined } as ProviderAvailability))
        setPartnerReviewSubmitted(Boolean(order.partnerReview?.rating))
        setPartnerReviewError(undefined)
        setStep(normalizedStatus === "cancelled" ? "duty" : "completed")
      } else if (normalizedStatus === "arrived" || normalizedStatus === "in_progress") {
        setStep("arrived")
      } else if (normalizedStatus === "accepted") {
        setStep("awaiting_price")
      } else {
        setStep("navigation")
      }
    } catch (error) {
      setOfferError(messageFromFetchError(error, "Не вдалося оновити статус замовлення. Спробуйте ще раз."))
    } finally {
      setOrderAdvancing(false)
    }
  }

  const cancelActiveOrder = async () => {
    if (!activeOrder?.id || orderAdvancing) return
    const confirmed = typeof window === "undefined" ? true : window.confirm("Скасувати цю заявку? Клієнт отримає сповіщення.")
    if (!confirmed) return
    await advanceProviderOrder("cancelled")
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
      const resolvedId = resolveSessionProviderId({ providerId: subject || undefined }, providerId)
      if (!resolvedId) {
        throw Object.assign(new Error("Сесію партнера не відкрито. Оновіть сторінку або увійдіть знову."), {
          detail: "provider_session_missing",
        })
      }
      if (resolvedId !== providerId) {
        setProviderId(resolvedId)
        storeLinkedProviderId(resolvedId)
      } else {
        storeLinkedProviderId(resolvedId)
      }
      return { token: providerAuthToken, providerId: resolvedId }
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

  useEffect(() => {
    if (!providerAuthToken) return
    let cancelled = false
    const restoreAssignedOrder = async () => {
      try {
        const session = await ensureProviderSession()
        if (cancelled) return
        const stored = readActiveOrder()
        if (stored?.orderId && (!activeOrder?.id || activeOrder.id === stored.orderId)) {
          try {
            const snapshot = await getOrder(stored.orderId, session.token)
            if (!cancelled && snapshot?.id) {
              const nextStatus = normalizeOrderStatus(snapshot.status)
              setActiveOrder(snapshot)
              persistActiveOrder(snapshot.id, nextStatus)
              setProviderProfile((profile) => ({
                ...profile,
                status: "busy",
                assignedOrderId: snapshot.id,
              } as ProviderAvailability))
              if (nextStatus === "accepted") setStep("awaiting_price")
              else if (nextStatus === "arrived" || nextStatus === "in_progress") setStep("arrived")
              else if (nextStatus === "completed") setStep("completed")
              else if (nextStatus !== "cancelled" && nextStatus !== "searching") setStep("navigation")
              return
            }
          } catch {
            // Fall through to provider order history.
          }
        }
        const pendingReview = readPendingPartnerReview()
        if (pendingReview?.orderId && (!activeOrder?.id || activeOrder.id === pendingReview.orderId)) {
          try {
            const snapshot = await getOrder(pendingReview.orderId, session.token)
            if (!cancelled && snapshot?.id) {
              const nextStatus = normalizeOrderStatus(snapshot.status)
              if (nextStatus === "completed") {
                setActiveOrder(snapshot)
                setPartnerReviewSubmitted(Boolean(snapshot.partnerReview?.rating))
                if (snapshot.partnerReview?.rating) clearPendingPartnerReview()
                setStep("completed")
                return
              }
              clearPendingPartnerReview()
            }
          } catch {
            // Fall through to active order history.
          }
        }
        if (activeOrder?.id && activeOrder.service) return
        const orders = await getProviderOrders(session.providerId, session.token, 20)
        if (cancelled) return
        const active = pickLatestActiveOrder(orders)
        if (!active?.orderId) return
        const full = orders.find((item) => item.id === active.orderId) ?? (await getOrder(active.orderId, session.token))
        if (cancelled || !full?.id) return
        const nextStatus = normalizeOrderStatus(full.status)
        setActiveOrder(full)
        persistActiveOrder(full.id, nextStatus)
        setProviderProfile((profile) => ({ ...profile, status: "busy", assignedOrderId: full.id } as ProviderAvailability))
        if (nextStatus === "accepted") setStep("awaiting_price")
        else if (nextStatus === "arrived" || nextStatus === "in_progress") setStep("arrived")
        else if (nextStatus === "completed") setStep("completed")
        else setStep("navigation")
      } catch {
        // Keep duty map if restore fails.
      }
    }
    void restoreAssignedOrder()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerAuthToken, providerId])

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
      if (isProviderPhoneVerified(updated)) {
        profileGateOpenRef.current = false
      } else {
        profileGateOpenRef.current = true
      }
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
    setPresenceSaving(true)
    setOfferError(undefined)
    setPresenceToast(undefined)
    try {
      const session = await ensureProviderSession()
      // Reload after self-session so ensure_linked_provider_profile's registeredAt is visible.
      const fresh = await getProviderProfile(session.providerId, session.token).catch(() => undefined)
      if (fresh?.id) {
        applyLoadedProvider(fresh)
      }
      const freshProfile = fresh?.id ? fresh : providerProfile
      const registeredComplete = isPartnerProfileComplete(
        {
          name: freshProfile.name || registrationForm.name,
          phone: freshProfile.phone || registrationForm.phone,
          plate: freshProfile.plate || registrationForm.plate,
          specialties: freshProfile.specialties?.length ? freshProfile.specialties : registrationForm.specialties,
          vehicle:
            String(freshProfile.vehicle || "").trim() ||
            (partnerVehicleSelectionIsComplete(registrationForm.vehicleMake, registrationForm.vehicleMakeOther, registrationForm.vehicleModel)
              ? registrationForm.vehicle || `${registrationForm.vehicleMake} ${registrationForm.vehicleModel}`.trim()
              : ""),
          registeredAt: freshProfile.registeredAt,
        },
        { treatAsRegistered: effectiveProviderRegistered },
      )
      const verified =
        isProviderPhoneVerified(freshProfile) ||
        Boolean(customerOtpProfile && isCustomerVerified(customerOtpProfile))

      if (verified && providerProfile.verificationStatus !== "verified") {
        markProviderPhoneVerified(fresh)
      }

      if (nextDuty && !registeredComplete) {
        const message = "Спочатку заповніть профіль партнера (авто, номер і послуги)."
        setOfferError(message)
        setPresenceToast(message)
        profileGateOpenRef.current = true
        setStep("register")
        return
      }
      if (nextDuty && !verified) {
        const message = "Підтвердіть телефон кодом у Telegram, щоб вийти на лінію."
        setOfferError(message)
        setPresenceToast(message)
        profileGateOpenRef.current = true
        setStep("verify")
        return
      }

      if (nextDuty) {
        // Request notification permission in the same user-gesture turn when possible.
        void ensurePartnerAlertPermission()
        seenDutyAlertIdsRef.current = new Set()
        dutyAlertsSeededRef.current = false
        setIncomingOffers([])
        setNearbyRequestPins([])
        setMapRequestPins([])
        setSelectedRequestPin(undefined)
        setPresenceToast("Ви на лінії")
        setStep("duty")
      } else {
        setIncomingOffers([])
        setNearbyRequestPins([])
        setMapRequestPins([])
        setSelectedRequestPin(undefined)
      }

      const updated = await updateProviderPresence(session.providerId, {
        status: nextDuty ? "online" : "offline",
        location: providerLocation,
        etaMinutes: (fresh || providerProfile).etaMinutes ?? provider.etaMinutes,
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
    void setDuty(!onDuty)
  }

  const openPhoneOrProfileGate = () => {
    if (!isPartnerRegisteredAndCompleted) {
      profileGateOpenRef.current = true
      setStep("register")
      return
    }
    if (providerCanGoOnline) {
      void setDuty(true)
      return
    }
    profileGateOpenRef.current = true
    setStep("verify")
  }

  // Telegram «Вийти на лінію» opens screen=duty — actually go online once session+profile are ready.
  useEffect(() => {
    if (dutyAutoAttemptedRef.current) return
    if (initialScreen !== "duty") return
    if (!providerAuthToken || onDuty || presenceSaving) return
    if (step !== "duty") return
    if (!providerCanGoOnline && !(effectiveProviderRegistered || providerProfile.registeredAt)) return
    dutyAutoAttemptedRef.current = true
    void setDuty(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialScreen,
    providerAuthToken,
    onDuty,
    presenceSaving,
    step,
    providerCanGoOnline,
    effectiveProviderRegistered,
    providerProfile.registeredAt,
  ])

  const completingPartnerProfile = effectiveProviderRegistered

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
      getOrder(activeOrder.id!, providerAuthToken)
        .then((order) => {
          if (cancelled) return
          const normalizedStatus = normalizeOrderStatus(order.status)
          if (normalizedStatus === "cancelled") {
            rememberDismissedOffer(undefined, activeOrder.id)
            setActiveOrder(undefined)
            clearActiveOrder()
            setIncomingOffers([])
            setProviderProfile((profile) => ({ ...profile, status: "online", assignedOrderId: undefined } as ProviderAvailability))
            setStep("duty")
            return
          }
          setActiveOrder(order)
          if (step === "awaiting_price" && (normalizedStatus === "price_confirmed" || normalizedStatus === "en_route")) {
            setStep("navigation")
          } else if (normalizedStatus === "completed" && step !== "duty") {
            rememberDismissedOffer(undefined, order.id)
            setIncomingOffers([])
            clearActiveOrder()
            if (order.id) persistPendingPartnerReview(order.id)
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
    if (activeOrder?.id) {
      rememberDismissedOffer(undefined, activeOrder.id)
    }
    setActiveOrder(undefined)
    clearActiveOrder()
    clearPendingPartnerReview()
    setIncomingOffers([])
    setPartnerReviewSaving(false)
    setPartnerReviewError(undefined)
    setPartnerReviewSubmitted(false)
    setOfferError(undefined)
    setSelectedRequestPin(undefined)
    setProviderProfile((profile) => ({
      ...profile,
      status: onDuty ? "online" : profile.status,
      assignedOrderId: undefined,
    } as ProviderAvailability))
    setStep("duty")
  }, [activeOrder?.id, onDuty, rememberDismissedOffer])

  useEffect(() => {
    if (activeOrder?.partnerReview?.rating) {
      setPartnerReviewSubmitted(true)
      clearPendingPartnerReview()
    }
  }, [activeOrder?.id, activeOrder?.partnerReview?.rating])

  const submitPartnerOrderReview = useCallback(async ({ rating, comment }: { rating: number; comment: string }) => {
    if (!activeOrder?.id || partnerReviewSaving) return
    if (activeOrder.partnerReview?.rating) {
      setPartnerReviewSubmitted(true)
      clearPendingPartnerReview()
      return
    }
    setPartnerReviewSaving(true)
    setPartnerReviewError(undefined)
    const orderId = activeOrder.id
    const markReviewDone = (order?: OrderResponse) => {
      if (order) setActiveOrder(order)
      setPartnerReviewSubmitted(true)
      clearPendingPartnerReview()
      setPartnerReviewError(undefined)
    }
    const refreshOrder = async (token?: string) => {
      try {
        return await getOrder(orderId, token || providerAuthToken)
      } catch {
        return undefined
      }
    }
    try {
      let token = providerAuthToken
      let authorProviderId =
        activeOrder.assignedProviderId || activeOrder.partnerId || providerId
      if (!token || !authorProviderId) {
        const session = await ensureProviderSession()
        token = session.token
        authorProviderId = authorProviderId || session.providerId
      }
      if (!token || !authorProviderId) {
        throw Object.assign(new Error("Сесію партнера не відкрито. Оновіть сторінку або увійдіть знову."), {
          detail: "provider_session_missing",
        })
      }

      const postReview = (accessToken: string, providerKey: string) =>
        submitOrderReview(
          orderId,
          {
            role: "partner",
            rating,
            comment,
            authorId: providerKey,
            providerId: providerKey,
          },
          accessToken,
        )

      try {
        const updated = await postReview(token, authorProviderId)
        markReviewDone(updated)
        return
      } catch (firstError) {
        const status = firstError && typeof firstError === "object" && "status" in firstError
          ? Number((firstError as { status?: number }).status)
          : 0
        const transient =
          status === 401 ||
          status === 403 ||
          /з'єднатися|перевищив час|timeout|failed to fetch|network/i.test(
            messageFromFetchError(firstError, ""),
          )
        if (!transient) throw firstError
        const session = await ensureProviderSession()
        const retryId = activeOrder.assignedProviderId || activeOrder.partnerId || session.providerId || authorProviderId
        try {
          const updated = await postReview(session.token, retryId)
          markReviewDone(updated)
          return
        } catch (retryError) {
          const recovered = await refreshOrder(session.token)
          if (recovered?.partnerReview?.rating) {
            markReviewDone(recovered)
            return
          }
          throw retryError
        }
      }
    } catch (err) {
      const recovered = await refreshOrder()
      if (recovered?.partnerReview?.rating) {
        markReviewDone(recovered)
        return
      }
      const message = messageFromFetchError(err, "Не вдалося зберегти оцінку. Спробуйте ще раз.")
      if (message.includes("already") || message.includes("вже") || /REVIEW_ALREADY/i.test(String(err))) {
        const refreshed = await refreshOrder()
        markReviewDone(refreshed)
        return
      }
      setPartnerReviewError(message)
    } finally {
      setPartnerReviewSaving(false)
    }
  }, [
    activeOrder?.id,
    activeOrder?.assignedProviderId,
    activeOrder?.partnerId,
    activeOrder?.partnerReview?.rating,
    partnerReviewSaving,
    providerId,
    providerAuthToken,
  ])

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
    // Returning partner (server/account flag): wait for customer→provider self-session.
    // Do not use localStorage alone — that stuck first-time Mini App opens on an endless boot screen.
    if (providerRegistered && customerIdForOtp && customerTokenForOtp) {
      return <div className="pomich-boot-screen">Завантажуємо кабінет партнера…</div>
    }
    if (loginView === "register") {
      return (
        <ProviderRegistrationStep
          form={registrationForm}
          saving={registrationSaving}
          error={registrationError}
          completingProfile={completingPartnerProfile}
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
    const otpProfile: CustomerProfile = customerOtpProfile ?? {
      id: customerIdForOtp || providerId,
      name: providerProfile.name || registrationForm.name,
      phone: providerProfile.phone || registrationForm.phone,
      verificationStatus: providerProfile.verificationStatus,
    }
    return (
      <ScreenLayout className="pomich-screen-layout--form">
        <Header
          title="Підтвердження телефону"
          subtitle="Спочатку телефон, потім код з Telegram"
          onBack={() => {
            profileGateOpenRef.current = false
            setStep("duty")
          }}
        />
        <FormContainer>
          <div className="pomich-form-card">
            <OtpVerificationPanel
              profile={otpProfile}
              customerToken={customerTokenForOtp}
              isTelegram={telegramContext.isTelegram}
              telegramBotUsername={otpBotUsername}
              telegramBotKind={telegramContext.botKind}
              verifiedActionLabel="Вийти на лінію"
              phone={otpProfile.phone}
              onPhoneSaved={(savedPhone) => {
                setRegistrationForm((form) => ({ ...form, phone: savedPhone }))
                setProviderProfile((profile) => ({ ...profile, phone: savedPhone }))
              }}
              onVerified={async (saved) => {
                if (saved) setCustomerOtpProfile(saved)
                const currentProvider = await loadCurrentProvider()
                markProviderPhoneVerified(currentProvider)
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
        completingProfile={completingPartnerProfile}
        onChange={updateRegistrationForm}
        onToggleSpecialty={toggleRegistrationSpecialty}
        onSubmit={saveRegistration}
        onLogin={onRestoreAccount ? openPartnerRestoreOrLogin : undefined}
        onBack={completingPartnerProfile || effectiveProviderRegistered || Boolean(linkedPartnerId)
          ? () => {
              profileGateOpenRef.current = false
              setStep("duty")
            }
          : undefined}
      />
    )
  }

  if (step === "duty") {
    return (
      <>
      <RideScreen
        pickup={providerLocation}
        providers={onDuty ? [providerPresence] : []}
        requestPins={mapRequestPins}
        mapSubtitle={onDuty ? `На лінії · ${mapRequestPins.length} заявок поруч` : "Україна · партнер"}
        showAllProviders={false}
        showDirectoryProviders={false}
        expandedSheet={onDuty || dutySheetSnap === "expanded"}
        defaultSnap={dutySheetSnap}
        onAcceptRequest={acceptFromMapPin}
        onContactRequest={contactFromMapPin}
        onRequestPinSelect={openRequestPin}
        onRetryGeo={retryProviderGeolocation}
        geoLoading={providerGeoLoading}
        geoError={providerGeoError}
        recenterTrigger={providerRecenterTrigger}
      >
        <div data-sheet-peek>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ color: MUTED, fontWeight: 800, fontSize: 12 }}>Партнер POMICH</div>
              <div style={{ color: DARK, fontWeight: 950, fontSize: 18, marginTop: 2 }}>{onDuty ? "На лінії" : "Поза лінією"}</div>
            </div>
            <DutyStatusToggle onDuty={onDuty} saving={presenceSaving} disabled={presenceSaving} onToggle={handleDutyToggle} />
          </div>
          {activeOffer ? (
            <div style={{ marginTop: 10, background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: 10, fontWeight: 850, fontSize: "var(--pomich-text-sm)" }}>
              Нова заявка · {secondsLeft > 0 ? `${secondsLeft} сек` : "час вийшов"}
            </div>
          ) : null}
          {onDuty ? (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <SecondaryButton label="Піти з лінії" onClick={() => setDuty(false)} disabled={!providerAuthToken} />
              {activeOffer ? (
                <PrimaryButton
                  label={offerSaving ? "Приймаємо…" : "Відкрити заявку"}
                  onClick={() => openOfferDetail(activeOffer)}
                  disabled={offerSaving}
                />
              ) : null}
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              <PrimaryButton
                label={
                  !isPartnerRegisteredAndCompleted
                    ? "Завершити профіль"
                    : !providerCanGoOnline
                      ? "Підтвердити телефон"
                      : presenceSaving
                        ? "Оновлюємо статус…"
                        : "Вийти на лінію"
                }
                onClick={() => {
                  if (!isPartnerRegisteredAndCompleted || !providerCanGoOnline) {
                    openPhoneOrProfileGate()
                    return
                  }
                  void setDuty(true)
                }}
                disabled={presenceSaving}
              />
            </div>
          )}
        </div>
        <div data-sheet-full>
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
                <div style={{ color: MUTED, fontSize: 12, fontWeight: 800 }}>Активних пропозицій</div>
                <div style={{ color: DARK, fontWeight: 950, marginTop: 4 }}>{incomingOffers.filter((offer) => isPresentableOffer(offer, offerClock)).length}</div>
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
                      return
                    }
                    const subjectId = readAuthSessionSubject(providerAuthToken || "") || providerId
                    if (!providerAuthToken) return
                    getProviderOffers(subjectId, providerAuthToken)
                      .then((offers) => {
                        setIncomingOffers(filterVisibleOffers(Array.isArray(offers) ? offers : [], {
                          dismissedOfferIds: dismissedOfferIdsRef.current,
                          dismissedOrderIds: dismissedOrderIdsRef.current,
                        }))
                      })
                      .catch(() => undefined)
                    const radiusKm = providerProfile.serviceRadiusKm ?? registrationForm.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM
                    getNearbyMapOrders(providerLocation.lat, providerLocation.lng, radiusKm, undefined, providerAuthToken)
                      .then((orders) => setNearbyRequestPins(Array.isArray(orders) ? orders : []))
                      .catch(() => undefined)
                  }}
                  disabled={offerSaving}
                />
                <SecondaryButton label="Піти з лінії" onClick={() => setDuty(false)} disabled={!providerAuthToken} />
              </>
            ) : (
              <PrimaryButton
                label={
                  !isPartnerRegisteredAndCompleted
                    ? "Завершити профіль"
                    : !providerCanGoOnline
                      ? "Підтвердити телефон"
                      : presenceSaving
                        ? "Оновлюємо статус…"
                        : "Вийти на лінію"
                }
                onClick={() => void setDuty(true)}
                disabled={presenceSaving}
              />
            )}
          </div>
          {offerError && offerError !== "Вкажіть вартість послуги в гривнях." ? <div style={{ background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: 12, fontWeight: 850 }}>{offerError}</div> : null}
        </div>
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
          onAccept={(price) => void acceptFromSheet(price)}
          onDecline={() => void declineFromSheet()}
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
    const completedPickup = activeOrder?.customerCoordinates ?? providerLocation
    const completedDestination = activeOrder?.destinationCoordinates
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
    const idleSecondsLeft = acceptedIdleSecondsLeft(activeOrder, offerClock)
    return (
      <ScreenLayout
        footer={
          <SecondaryButton
            label={orderAdvancing ? "Скасовуємо…" : "Скасувати заявку"}
            danger
            disabled={orderAdvancing}
            onClick={() => {
              void cancelActiveOrder()
            }}
          />
        }
      >
        <Header title="Очікуємо клієнта" subtitle={activeOrder?.id ? `Замовлення #${activeOrder.id}` : undefined} status="accepted" />
        <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
            <div style={{ fontWeight: 950, fontSize: 20, color: DARK }}>Ціну надіслано клієнту</div>
            <div style={{ color: MUTED, fontWeight: 750, marginTop: 8, lineHeight: 1.45 }}>
              Ви запропонували {typeof proposed === "number" ? `${proposed.toLocaleString("uk-UA")} ₴` : "ціну"}. Клієнт підтвердить або зв'яжеться для обговорення.
            </div>
            <div style={{ marginTop: 14, background: "var(--pomich-warn-bg)", color: "var(--pomich-warn-text)", borderRadius: 14, padding: 12, fontWeight: 800, lineHeight: 1.45 }}>
              {idleSecondsLeft > 0
                ? `Якщо клієнт не підтвердить ціну за ${formatCountdown(idleSecondsLeft)}, заявку буде скасовано.`
                : "Час очікування вийшов — заявку буде скасовано автоматично."}
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
      <ScreenLayout
        footer={
          <>
            <PrimaryButton
              label={activeStatus === "arrived" ? "ПОЧАТИ РОБОТУ" : "ЗАВЕРШИТИ"}
              loading={orderAdvancing}
              loadingLabel={activeStatus === "arrived" ? "Починаємо…" : "Завершуємо…"}
              onClick={() => {
                if (activeOrder) void advanceProviderOrder(nextStatus)
                else setStep("completed")
              }}
            />
            <SecondaryButton
              label={orderAdvancing ? "Скасовуємо…" : "Скасувати заявку"}
              danger
              disabled={orderAdvancing}
              onClick={() => {
                void cancelActiveOrder()
              }}
            />
          </>
        }
      >
        <Header title={activeStatus === "in_progress" ? "Допомога триває" : "Ви на місці"} subtitle="Клієнт бачить ваш статус у POMICH" status={activeStatus === "in_progress" ? "in_progress" : "arrived"} />
        <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
          <ProviderCard orderId={activeOrder?.id} assignedProvider={activeOrder?.assignedProvider ?? providerPresence} />
          <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14 }}>
            <Timeline status={activeStatus === "in_progress" ? "in_progress" : "arrived"} />
            <div style={{ fontWeight: 900, color: DARK, marginTop: 16 }}>Поточна дія</div>
            <div style={{ color: MUTED, fontWeight: 700, marginTop: 6 }}>
              {activeStatus === "arrived"
                ? "Натисніть «Почати роботу», коли починаєте допомогу клієнту."
                : "Підтвердіть завершення, коли допомогу надано."}
            </div>
          </div>
          {offerError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{offerError}</div> : null}
        </div>
      </ScreenLayout>
    )
  }

  if (step === "navigation") {
    const activeStatus = normalizeOrderStatus(activeOrder?.status)
    const nextStatus: OrderStatus = activeStatus === "price_confirmed" || activeStatus === "assigned" || activeStatus === "accepted" ? "en_route" : "arrived"
    const hasLiveGps = Number.isFinite(providerLocation.lat) && Number.isFinite(providerLocation.lng)
    // Never fall back to hardcoded Uzhhorod demo points — that drew a fake blue destination
    // and/or routed to the wrong pickup after accept.
    const routePickup = activeOrder?.customerCoordinates
    const routeDestination = activeOrder?.destinationCoordinates
    const customerLabel = activeOrder?.customerLocation || "Точка подачі клієнта"
    return (
      <ScreenLayout
        footer={
          <>
            <PrimaryButton
              label={activeStatus === "en_route" ? "Я НА МІСЦІ" : "ЇДУ ДО КЛІЄНТА"}
              loading={orderAdvancing}
              loadingLabel={activeStatus === "en_route" ? "Оновлюємо…" : "Виїжджаємо…"}
              disabled={activeStatus === "accepted"}
              onClick={() => {
                if (activeOrder) void advanceProviderOrder(nextStatus)
                else setStep("arrived")
              }}
            />
            <SecondaryButton
              label={orderAdvancing ? "Скасовуємо…" : "Скасувати заявку"}
              danger
              disabled={orderAdvancing}
              onClick={() => {
                void cancelActiveOrder()
              }}
            />
          </>
        }
      >
        <Header title="Маршрут до клієнта" subtitle={activeOrder?.id ? `Активне замовлення #${activeOrder.id}` : "Активне замовлення"} status={activeStatus === "en_route" ? "en_route" : "price_confirmed"} />
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
          {routePickup ? (
            <LazyRouteMap
              pickup={routePickup}
              destination={routeDestination}
              providerPosition={hasLiveGps ? providerLocation : undefined}
              subtitle={hasLiveGps ? "Ваша GPS-позиція" : "Очікуємо геолокацію"}
              mapTileTheme={mapTileTheme}
            />
          ) : (
            <div style={{ background: CARD, borderRadius: 18, border: `1px solid ${BORDER}`, padding: 14, color: MUTED, fontWeight: 700 }}>
              Немає координат клієнта для побудови маршруту. Оновіть заявку або попросіть клієнта надіслати геолокацію ще раз.
            </div>
          )}
          <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16 }}>
            <div style={{ fontWeight: 950, fontSize: 20 }}>{hasLiveGps ? "Навігація за GPS" : "Немає GPS"}</div>
            <div style={{ color: "#CBD5E1", marginTop: 6, fontWeight: 700 }}>Клієнт: {customerLabel}</div>
            <div style={{ color: "#CBD5E1", marginTop: 8, fontWeight: 700, lineHeight: 1.4 }}>
              {hasLiveGps
                ? "Позиція оновлюється з вашого пристрою. Імітацію руху вимкнено."
                : "Увімкніть геолокацію, щоб бачити себе на карті. Рух не імітується."}
            </div>
          </div>
          {offerError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{offerError}</div> : null}
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
        onAccept={(price) => void acceptOffer(activeOffer, price)}
        onDecline={() => void declineOffer(activeOffer)}
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
          onAccept={(price) => void acceptFromSheet(price)}
          onDecline={() => void declineFromSheet()}
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

  // Fallback: always restore duty controls (never a map-only shell without «Вийти на лінію»).
  return (
    <>
      <RideScreen
        pickup={providerLocation}
        providers={onDuty ? [providerPresence] : []}
        requestPins={mapRequestPins}
        mapSubtitle={onDuty ? `На лінії · ${mapRequestPins.length} заявок поруч` : "Україна · партнер"}
        showAllProviders={false}
        showDirectoryProviders={false}
        expandedSheet={onDuty || dutySheetSnap === "expanded"}
        defaultSnap={dutySheetSnap}
        onAcceptRequest={acceptFromMapPin}
        onContactRequest={contactFromMapPin}
        onRequestPinSelect={openRequestPin}
        onRetryGeo={retryProviderGeolocation}
        geoLoading={providerGeoLoading}
        geoError={providerGeoError}
        recenterTrigger={providerRecenterTrigger}
      >
        <div data-sheet-peek>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div>
              <div style={{ color: MUTED, fontWeight: 800, fontSize: 12 }}>Партнер POMICH</div>
              <div style={{ color: DARK, fontWeight: 950, fontSize: 18, marginTop: 2 }}>{onDuty ? "На лінії" : "Поза лінією"}</div>
            </div>
            <DutyStatusToggle onDuty={onDuty} saving={presenceSaving} disabled={presenceSaving} onToggle={handleDutyToggle} />
          </div>
          <div style={{ marginTop: 10 }}>
            <PrimaryButton
              label={
                !isPartnerRegisteredAndCompleted
                  ? "Завершити профіль"
                  : !providerCanGoOnline
                    ? "Підтвердити телефон"
                    : presenceSaving
                      ? "Оновлюємо статус…"
                      : onDuty
                        ? "Знятися з лінії"
                        : "Вийти на лінію"
              }
              onClick={() => {
                if (onDuty) {
                  void setDuty(false)
                } else if (!isPartnerRegisteredAndCompleted || !providerCanGoOnline) {
                  openPhoneOrProfileGate()
                } else {
                  void setDuty(true)
                }
              }}
              disabled={presenceSaving}
            />
          </div>
        </div>
        <div data-sheet-full>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <SheetHeading title="Партнер POMICH" subtitle={onDuty ? "Ви на лінії — заявки на карті" : "Вийдіть на лінію, щоб бачити заявки"} />
            <DutyStatusToggle onDuty={onDuty} saving={presenceSaving} disabled={presenceSaving} onToggle={handleDutyToggle} />
          </div>
          <div style={{ marginTop: 14 }}>
            <PrimaryButton
              label={
                !isPartnerRegisteredAndCompleted
                  ? "Завершити профіль"
                  : !providerCanGoOnline
                    ? "Підтвердити телефон"
                    : presenceSaving
                      ? "Оновлюємо статус…"
                      : onDuty
                        ? "Знятися з лінії"
                        : "Вийти на лінію"
              }
              onClick={() => {
                if (onDuty) {
                  void setDuty(false)
                } else if (!isPartnerRegisteredAndCompleted || !providerCanGoOnline) {
                  openPhoneOrProfileGate()
                } else {
                  void setDuty(true)
                }
              }}
              disabled={presenceSaving}
            />
          </div>
        </div>
      </RideScreen>
    </>
  )
}
