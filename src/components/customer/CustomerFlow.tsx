import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import {
  cancelOrder as cancelOrderRequest,
  confirmOrderPrice,
  createGuestCustomerSession,
  createOrder,
  getCustomerOrders,
  getOrder,
  getProviders,
  getTelegramSession,
  messageFromFetchError,
  retryDispatch,
  submitOrderReview,
  updateCustomerProfile,
  type AuthSession,
  type CustomerProfile,
  type OrderResponse,
  type ProviderAvailability,
  type VerificationStatus,
} from "../../api/client"
import { RideScreen } from "../layout/RideScreen"
import { useDirectoryScope } from "../../hooks/useDirectoryScope"
import type { DirectoryScopeMode } from "../../lib/directoryScope"
import {
  calculateDistanceKm,
  calculatePrice,
  ON_SITE_DESTINATION_LABEL,
  sanitizeLocation,
  serviceRequiresDestination,
  validateCustomerOrderInput,
  type CustomerOrderInput,
  type ServiceKey,
} from "../../lib/pomichDomain"
import { getTelegramContext } from "../../telegram"
import {
  getProfileChecklist,
  customerProfileStatusLabel,
  customerProfileStatusTone,
  isCustomerProfileComplete,
  isCustomerReadyForOrder,
  isCustomerVerified,
  mergeCustomerProfiles,
  profileChecklistItemStatus,
  profileChecklistSummary,
} from "../../lib/customerProfile"
import {
  PICKUP,
  DEFAULT_DESTINATION,
  services,
  provider,
  vehicleOptions,
  orderStatusLabels,
  getServiceLabel,
  getServiceDescription,
  getProviderCapabilityLabel,
  toServiceKeys,
  getServiceEmoji,
  providerStatusLabel,
  verificationLabel,
  verificationTone,
  isVerified,
  nearbyProvidersFor,
  distanceToProvider,
  type Point,
  type OrderStatus,
  type Screen,
  type GeoState,
} from "../../lib/constants"
import {
  authSessionStorageKey,
  guestSessionCustomerIdForRestore,
  isExplicitLogout,
  purgeStaleCustomerSessions,
  readPersistedCustomerId,
  readStoredAuthSession,
  storeAuthSession,
} from "../../lib/auth"
import {
  clearActiveOrder,
  enrichProfileWithTelegram,
  isActiveOrderStatus,
  isTerminalOrderStatus,
  persistActiveOrder,
  pickLatestActiveOrder,
  readActiveOrder,
  readBootstrapProfileForCustomer,
  resolveCustomerAuthSession,
} from "../../lib/customerSession"
import { reverseGeocodeAddress } from "../../lib/reverseGeocode"
import { MAP_GEO_DEBOUNCE_MS, MAP_RECENTER_THRESHOLD_M, requestCurrentPosition, shouldRecenterMap } from "../../lib/mapGeo"
import { syncProfileCityFromGeo } from "../../lib/syncProfileCityFromGeo"
import { OrderErrorStep, OrderFinalStep } from "./OrderTerminalStep"
import { useTelegramMainButton, useTelegramBackButton, useTelegramUx } from "../../hooks/useTelegramUx"
import { normalizeOrderStatus, screenForOrderStatus } from "../../lib/orderStatus"
import { acceptedIdleSecondsLeft, formatCountdown } from "../../lib/dispatchOffer"
import FormContainer, { FormFooterBar, FormHeader } from "../layout/FormContainer"
import { PhoneInput } from "../ui/PhoneInput"
import { FieldError } from "../ui/FieldError"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { formatLocalPhoneDisplay, nationalDigitsFromPhone, phoneInputValueFromStored, validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { validatePersonName } from "../../lib/personName"
import { ThemeToggle } from "../ui/ThemeToggle"
import { PartnerProfileSheet } from "../ui/PartnerProfileSheet"
import { CitySelect } from "../ui/CitySelect"
import { DEFAULT_SERVICE_CITY, normalizeServiceCity, serviceCityCenter } from "../../lib/ukraineCities"
import { subscribeOrderEvents } from "../../lib/realtime"

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

function VerificationPill({ status }: { status?: VerificationStatus }) {
  const tone = verificationTone(status)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: tone.background, border: `1px solid ${tone.border}`, color: tone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: tone.color }} />
      {verificationLabel(status)}
    </span>
  )
}

const FLOW_STEP_LABELS = [
  "Оберіть проблему",
  "Де ви зараз?",
  "Куди / на місці",
  "Стан авто",
  "Перевірте заявку",
] as const

type DirectoryMapRideProps = {
  providers: ProviderAvailability[]
  directoryScope?: DirectoryScopeMode
  onDirectoryScopeChange?: (scope: DirectoryScopeMode) => void
  directoryScopeCity?: string
  directoryScopeGeoLoading?: boolean
  directoryScopeGeoError?: string
  onDirectoryScopeGeoRetry?: () => void
  directoryScopeRecenterTrigger?: number
  directoryScopeCityCenter?: Point
  onProviderSelect?: (provider: ProviderAvailability) => void
}

function StepBadge({ step }: { step: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="pomich-step-badge">
      Крок {step} з {FLOW_STEP_LABELS.length} · {FLOW_STEP_LABELS[step - 1]}
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
    city: normalizeServiceCity(profile.city),
  })

  useEffect(() => {
    setDraft((current) => {
      const next = {
        name: profile.name || "",
        phone: phoneInputValueFromStored(profile.phone),
        email: profile.email || "",
        city: normalizeServiceCity(profile.city),
      }
      const currentPhoneValid = validateUkraineMobilePhone(current.phone).valid
      const nextPhoneValid = validateUkraineMobilePhone(next.phone).valid
      if (currentPhoneValid && !nextPhoneValid) next.phone = current.phone
      if (current.name.trim() && !next.name.trim()) next.name = current.name
      if (current.email.trim() && !next.email.trim()) next.email = current.email
      if (!currentPhoneValid && nextPhoneValid) next.phone = next.phone
      return next
    })
  }, [profile.id, profile.name, profile.phone, profile.email, profile.city])

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
        <CitySelect
          value={draft.city || profile.city || DEFAULT_SERVICE_CITY}
          onChange={(city) => {
            patchDraft({ city })
            if (typeof window !== "undefined") window.localStorage.setItem("pomichPreferredCity", city)
          }}
          label="Місто для довідника СТО/АЗС"
        />
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
  serviceCity,
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
  onServiceCityChange,
  onSelect,
  onProviderSelect,
  directoryScope,
  onDirectoryScopeChange,
  directoryScopeCity,
  directoryScopeGeoLoading,
  directoryScopeGeoError,
  onDirectoryScopeGeoRetry,
  directoryScopeRecenterTrigger,
  directoryScopeCityCenter,
}: {
  pickup: Point
  locationLabel: string
  serviceCity: string
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
  onServiceCityChange: (city: string) => void
  onSelect: (service: ServiceKey) => void
  onProviderSelect?: (provider: ProviderAvailability) => void
  directoryScope?: import("../../lib/directoryScope").DirectoryScopeMode
  onDirectoryScopeChange?: (scope: import("../../lib/directoryScope").DirectoryScopeMode) => void
  directoryScopeCity?: string
  directoryScopeGeoLoading?: boolean
  directoryScopeGeoError?: string
  onDirectoryScopeGeoRetry?: () => void
  directoryScopeRecenterTrigger?: number
  directoryScopeCityCenter?: Point
}) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const profileReady = isCustomerReadyForOrder(customerProfile)

  const handleSelect = (service: ServiceKey) => {
    if (!profileReady) return
    onSelect(service)
  }

  return (
    <RideScreen
      pickup={pickup}
      providers={providers}
      mapSubtitle={`${locationLabel} · ${directoryScope === "my-city" && directoryScopeCity ? directoryScopeCity : directoryScope === "all-ukraine" ? "Україна" : serviceCity}`}
      defaultSnap="half"
      recenterTrigger={recenterTrigger}
      onRetryGeo={onRetryGeo}
      geoLoading={geoLoading}
      geoError={geoError}
      onProviderSelect={onProviderSelect}
      directoryScope={directoryScope}
      onDirectoryScopeChange={onDirectoryScopeChange}
      directoryScopeCity={directoryScopeCity}
      directoryScopeGeoLoading={directoryScopeGeoLoading}
      directoryScopeGeoError={directoryScopeGeoError}
      onDirectoryScopeGeoRetry={onDirectoryScopeGeoRetry}
      directoryScopeRecenterTrigger={directoryScopeRecenterTrigger}
      directoryScopeCityCenter={directoryScopeCityCenter}
      mapZoom={directoryScope === "all-ukraine" ? 6 : undefined}
    >
      <div data-sheet-full>
      <StepBadge step={1} />
      <SheetHeading title="Потрібна допомога на дорозі?" subtitle="Спочатку заповніть профіль, потім оберіть проблему." />

      <CurrentLocationCard locationLabel={locationLabel} geoLoading={geoLoading} geoError={geoError} onRefreshGeo={onRetryGeo}>
        <SheetDivider />
        <div className="pomich-location-hint" aria-disabled="true">
          <LocationRow icon="🏁" title="Куди везти або де ремонтувати" subtitle="Уточнимо після вибору послуги" />
        </div>
      </CurrentLocationCard>

      {directoryScope === "my-city" ? (
        <div style={{ marginTop: 12 }}>
          <CitySelect
            id="pomich-customer-home-city"
            value={serviceCity}
            onChange={onServiceCityChange}
            label="Місто для карти та партнерів"
          />
        </div>
      ) : null}

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
          {nearby.length > 0 ? `${nearby.length} поруч` : "підберемо партнера"}
        </div>
      </div>

      <div className="pomich-flow-stack">
        {services.map((service) => (
          <button key={service.key} type="button" onClick={() => handleSelect(service.key as ServiceKey)} disabled={!profileReady} className="pomich-service-row" style={{ background: profileReady ? CARD : GHOST, opacity: profileReady ? 1 : 0.7 }}>
            <span className="pomich-service-row__icon" style={{ background: service.tone }}>{service.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span className="pomich-service-row__label">{service.label}</span>
              <span className="pomich-service-row__hint">{getServiceDescription(service.key)}</span>
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
            {nearby.length > 0 ? `${nearby.length} поруч` : "підберемо партнера"}
          </div>
        </div>
        {services[0] ? (
          <button type="button" onClick={() => handleSelect(services[0].key as ServiceKey)} disabled={!profileReady} className="pomich-service-row" style={{ background: profileReady ? CARD : GHOST, opacity: profileReady ? 1 : 0.7 }}>
            <span className="pomich-service-row__icon" style={{ background: services[0].tone }}>{services[0].emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span className="pomich-service-row__label">{services[0].label}</span>
              <span className="pomich-service-row__hint">{getServiceDescription(services[0].key)} · ↑ усі</span>
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
  ...directoryMap
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
} & DirectoryMapRideProps) {
  const geoStatusHint = geoError ? undefined : geoLoading ? "Визначаємо ваше місцезнаходження…" : geoMessage

  return (
    <RideScreen
      pickup={pickup}
      mapSubtitle="Ваше місцезнаходження · перетягніть маркер"
      onPick={onPick}
      mapFocus
      onRetryGeo={onRetryGeo}
      geoLoading={geoLoading}
      geoError={geoError}
      recenterTrigger={recenterTrigger}
      {...directoryMap}
    >
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
  ...directoryMap
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
} & DirectoryMapRideProps) {
  const needsDestination = serviceRequiresDestination(serviceKey)
  const title = needsDestination ? "Куди доставити авто?" : "Допомога на місці"
  const subtitle = needsDestination
    ? "Натисніть на карті або введіть адресу СТО / точки доставки."
    : ON_SITE_DESTINATION_LABEL

  return (
    <RideScreen
      pickup={pickup}
      destination={needsDestination ? destination : pickup}
      mapSubtitle={needsDestination ? "Оберіть точку на карті" : "Ваше місцезнаходження"}
      onPick={needsDestination ? onPick : undefined}
      mapFocus={needsDestination}
      {...directoryMap}
    >
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
      <StepBadge step={4} />
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
  ...directoryMap
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
} & DirectoryMapRideProps) {
  const showDestination = serviceRequiresDestination(serviceKey) && Boolean(destination.trim())
  const onSiteLabel = !serviceRequiresDestination(serviceKey)

  return (
    <RideScreen
      pickup={pickup}
      destination={onSiteLabel ? pickup : destinationPoint}
      mapSubtitle="Перевірка заявки"
      {...directoryMap}
    >
      <StepBadge step={5} />
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
          onFocus={(event) => {
            if (typeof event.target?.scrollIntoView === "function") {
              setTimeout(() => event.target.scrollIntoView({ behavior: "smooth", block: "center" }), 150)
            }
          }}
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

function SearchingStep({ orderId, status, order, pickup, destination, cancelError, cancelling, onCancel, onRetryDispatch }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; cancelError?: string; cancelling?: boolean; onCancel: () => void; onRetryDispatch: () => void }) {
  const noProviders = order?.dispatchState === "NO_PROVIDERS_AVAILABLE"
  const offers = order?.offers ?? []
  const pendingOffers = offers.filter((offer) => offer.status === "pending").length
  const offersSent = order?.dispatchInfo?.offersSent ?? offers.length
  const offersExhausted =
    !noProviders &&
    status === "searching" &&
    offersSent > 0 &&
    pendingOffers === 0 &&
    offers.some((offer) => offer.status === "expired" || offer.status === "declined" || offer.status === "lost")
  const showRetry = noProviders || offersExhausted

  return (
    <RideScreen pickup={pickup} destination={destination} providers={order?.assignedProvider ? [order.assignedProvider] : undefined} mapSubtitle={orderId ? `#${orderId}` : "Очікуємо партнера"}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading
          title={showRetry ? "Пошук не дав результату" : "Очікуємо партнера"}
          subtitle={
            noProviders
              ? "Немає вільних партнерів поруч"
              : offersExhausted
                ? "Партнери не відповіли вчасно"
                : orderId
                  ? `Замовлення #${orderId}`
                  : "Шукаємо найближчого перевіреного партнера…"
          }
        />
        <StatusPill status={status} />
      </div>

      <div className="pomich-radar-container">
        <div className="pomich-radar-ring" />
        <div className="pomich-radar-ring" />
        <div className="pomich-radar-ring" />
        <div className="pomich-radar-beam" />
        <div className="pomich-radar-center-icon">🚛</div>
      </div>

      <div style={{ color: MUTED, fontWeight: 750, lineHeight: 1.4, textAlign: "center" }}>
        {noProviders
          ? "Можна повторити пошук без створення нової заявки."
          : offersExhausted
            ? "Система повторює пошук автоматично. Можна також натиснути «Спробувати ще раз»."
            : offersSent > 0
              ? `Звернулися до ${offersSent} партнерів. Перший, хто підтвердить, отримає заявку.`
              : "Скануємо найближчих партнерів на лінії… Партнери бачать ваше місцезнаходження."}
      </div>
      <div style={{ marginTop: 16 }}><Timeline status={status} /></div>
      <div style={{ marginTop: 16, display: "grid", gap: 9 }}>
        {[
          { text: "Заявку надіслано в систему", active: true },
          { text: "Сканування та розсилка партнерам", active: true },
          { text: "Очікування підтвердження ціни", active: !showRetry },
        ].map((item) => (
          <div key={item.text} style={{ background: SURFACE_TONE, borderRadius: 15, border: `1px solid ${BORDER}`, padding: "12px 14px", fontWeight: 850, color: DARK, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: item.active ? "var(--pomich-accent, #16a36a)" : "var(--pomich-muted)", fontWeight: 900 }}>{item.active ? "✓" : "⏳"}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        {showRetry ? <PrimaryButton label="Спробувати ще раз" onClick={onRetryDispatch} /> : null}
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
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
  cancelError,
  cancelling,
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
  cancelError?: string
  cancelling?: boolean
  onConfirmPrice: () => void
  onContact: () => void
  onCancel: () => void
}) {
  const assignedProvider = order?.assignedProvider
  const eta = assignedProvider?.etaMinutes
  const proposedPrice = order?.partnerProposedPrice
  const partnerName = assignedProvider?.name ?? order?.providerName
  const priceLabel = typeof proposedPrice === "number" ? `${proposedPrice.toLocaleString("uk-UA")} ₴` : "—"
  const [clock, setClock] = useState(Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  const idleSecondsLeft = acceptedIdleSecondsLeft(order, clock)

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
          {partnerName ?? "Партнер"} запропонував {typeof proposedPrice === "number" ? priceLabel : "ціну"}.{" "}
          {idleSecondsLeft > 0
            ? `Підтвердіть протягом ${formatCountdown(idleSecondsLeft)}, інакше заявку буде скасовано.`
            : "Час підтвердження вийшов — заявку буде скасовано автоматично."}
        </div>
        {confirmError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{confirmError}</div> : null}
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
      </div>
      <div className="pomich-price-confirm-actions">
        <PrimaryButton label={confirming ? "Підтверджуємо…" : "Підтвердити ціну"} onClick={onConfirmPrice} loading={confirming} disabled={confirming || cancelling || typeof proposedPrice !== "number"} />
        <SecondaryButton label="Зв'язатися" onClick={onContact} disabled={cancelling} />
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
      </div>
      </div>
    </RideScreen>
  )
}

function AssignedStep({ orderId, status, order, pickup, destination, isTelegram, cancelError, cancelling, onTrack, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; isTelegram?: boolean; cancelError?: string; cancelling?: boolean; onTrack: () => void; onCancel: () => void }) {
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
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        {isTelegram ? null : <PrimaryButton label="Дивитися маршрут" onClick={onTrack} disabled={cancelling} />}
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function TrackingStep({ orderId, status, order, pickup, destination, cancelError, cancelling, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; cancelError?: string; cancelling?: boolean; onCancel: () => void }) {
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
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        <PrimaryButton label={eta ? `Очікувати · ${eta} хв` : "Очікуємо партнера"} disabled />
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати заявку"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function ArrivedStep({ orderId, status, order, pickup, destination, cancelError, cancelling, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; cancelError?: string; cancelling?: boolean; onCancel: () => void }) {
  return (
    <RideScreen pickup={pickup} destination={destination} providerPosition={pickup} mapSubtitle="Виконавець на місці">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <SheetHeading title="Виконавець на місці" subtitle={orderId ? `Замовлення #${orderId}` : undefined} />
        <StatusPill status={status} />
      </div>
      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <ProviderCard orderId={orderId} assignedProvider={order?.assignedProvider} />
        <div style={{ background: CARD, borderRadius: 18, padding: 16, border: `1px solid ${BORDER}` }}>
          <Timeline status={status} />
          <div style={{ marginTop: 16, fontWeight: 900, color: DARK }}>Партнер прибув на місце</div>
          <div style={{ marginTop: 6, color: MUTED, fontWeight: 700 }}>Статус оновиться автоматично, коли партнер почне та завершить роботи в системі.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        <PrimaryButton label="Очікуємо початок робіт" disabled />
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

function InProgressStep({ orderId, status, order, pickup, destination, cancelError, cancelling, onCancel }: { orderId?: string; status: OrderStatus; order?: OrderResponse; pickup: Point; destination: Point; cancelError?: string; cancelling?: boolean; onCancel: () => void }) {
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
        {cancelError ? <div style={{ background: "var(--pomich-error-bg)", color: "var(--pomich-error-text)", borderRadius: 14, padding: 12, fontWeight: 800 }}>{cancelError}</div> : null}
        <PrimaryButton label="Очікуємо завершення робіт" disabled />
        <SecondaryButton label={cancelling ? "Скасовуємо…" : "Скасувати"} danger disabled={cancelling} onClick={onCancel} />
      </div>
    </RideScreen>
  )
}

export default function CustomerFlow({ onLogout }: { onLogout?: () => void } = {}) {
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
  const [vehicleState, setVehicleState] = useState("")
  const [customerComment, setCustomerComment] = useState("")
  const [loading, setLoading] = useState(false)
  const [priceConfirming, setPriceConfirming] = useState(false)
  const [priceConfirmError, setPriceConfirmError] = useState<string | undefined>()
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | undefined>()
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
  const {
    scope: directoryScope,
    setScope: setDirectoryScope,
    resolvedCity: directoryScopeCity,
    cityCenter: directoryScopeCityCenter,
    providers: nearbyProviders,
    loading: providersLoading,
    recenterTrigger: directoryScopeRecenterTrigger,
    geoError: directoryScopeGeoError,
    geoLoading: directoryScopeGeoLoading,
    retryGeo: retryDirectoryGeo,
    fetchProvidersNear,
    refetchProviders,
  } = useDirectoryScope({ refreshMs: 10000 })
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
  const [selectedPartnerProfile, setSelectedPartnerProfile] = useState<ProviderAvailability | null>(null)
  const userInitiatedCancelRef = useRef(false)

  const serviceCity = useMemo(
    () =>
      normalizeServiceCity(
        customerProfile.city ||
          (typeof window !== "undefined" ? window.localStorage.getItem("pomichPreferredCity") : null),
      ),
    [customerProfile.city],
  )


  const applyServiceCity = useCallback(
    (nextCity: string) => {
      const normalized = normalizeServiceCity(nextCity)
      if (normalized === serviceCity) return
      if (typeof window !== "undefined") window.localStorage.setItem("pomichPreferredCity", normalized)
      setCustomerProfile((profile) => ({ ...profile, city: normalized }))
      const center = serviceCityCenter(normalized)
      pickupRef.current = center
      setPickup(center)
      setAddressLabel(normalized)
      setGeoMessage(`Місто: ${normalized}`)
      setGeoRecenterTrigger((value) => value + 1)
      if (customerId && customerAuthToken) {
        updateCustomerProfile(customerId, { city: normalized }, customerAuthToken).catch(() => undefined)
      }
    },
    [serviceCity, customerId, customerAuthToken],
  )

  useEffect(() => {
    if (screen !== "home") return
    if (directoryScope === "all-ukraine") return
    const center = serviceCityCenter(serviceCity)
    if (shouldRecenterMap(pickupRef.current, center, 25_000)) {
      pickupRef.current = center
      setPickup(center)
      setGeoRecenterTrigger((value) => value + 1)
    }
  }, [screen, serviceCity, directoryScope])

  const directoryMapProps = useMemo(
    (): DirectoryMapRideProps => ({
      providers: nearbyProviders,
      directoryScope,
      onDirectoryScopeChange: setDirectoryScope,
      directoryScopeCity: directoryScopeCity ?? undefined,
      directoryScopeGeoLoading: directoryScopeGeoLoading,
      directoryScopeGeoError: directoryScopeGeoError,
      onDirectoryScopeGeoRetry: retryDirectoryGeo,
      directoryScopeRecenterTrigger: directoryScopeRecenterTrigger,
      directoryScopeCityCenter: directoryScopeCityCenter ?? undefined,
      onProviderSelect: setSelectedPartnerProfile,
    }),
    [
      nearbyProviders,
      directoryScope,
      setDirectoryScope,
      directoryScopeCity,
      directoryScopeGeoLoading,
      directoryScopeGeoError,
      retryDirectoryGeo,
      directoryScopeRecenterTrigger,
      directoryScopeCityCenter,
    ],
  )

  const prevFlowScreenRef = useRef(screen)
  useEffect(() => {
    const prev = prevFlowScreenRef.current
    prevFlowScreenRef.current = screen
    if (screen === "home" && prev !== "home") {
      void refetchProviders()
      return
    }
    if (screen === "location" || screen === "destination" || screen === "details" || screen === "review") {
      void fetchProvidersNear(pickup, 45)
    }
  }, [screen, pickup.lat, pickup.lng, fetchProvidersNear, refetchProviders])

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
        if (resolved.profile) {
          setCustomerProfile((current) => {
            const merged = mergeCustomerProfiles(current, resolved.profile!)
            if (
              current.id === merged.id &&
              current.name === merged.name &&
              current.phone === merged.phone &&
              current.city === merged.city &&
              current.verificationStatus === merged.verificationStatus
            ) {
              return current
            }
            return merged
          })
        }
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [telegramContext.initData, telegramContext.chatId, telegramContext.user?.first_name, telegramContext.user?.last_name, telegramContext.user?.username])

  useEffect(() => {
    if (!telegramContext.chatId || !telegramContext.initData) return

    getTelegramSession(telegramContext.chatId, telegramContext.initData, telegramContext.botKind)
      .then((session) => {
        if (session.customerId) setCustomerId(session.customerId)
        if (session.profile) {
          setCustomerProfile((profile) => {
            const merged = mergeCustomerProfiles(profile, { ...session.profile!, id: session.customerId ?? profile.id })
            if (
              profile.id === merged.id &&
              profile.name === merged.name &&
              profile.phone === merged.phone &&
              profile.city === merged.city &&
              profile.verificationStatus === merged.verificationStatus
            ) {
              return profile
            }
            return merged
          })
        }
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
          const targetCity = result.saved?.city || result.city
          if (
            profile.city === targetCity &&
            (!result.saved || profile.verificationStatus === result.saved.verificationStatus)
          ) {
            return profile
          }
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

  /* Restore in-progress order after Telegram WebApp reopen (sessionStorage often wiped). */
  useEffect(() => {
    let cancelled = false

    const resetToHome = () => {
      setOrderId(undefined)
      setCurrentOrder(undefined)
      setStatus("draft")
      setScreen("home")
      clearActiveOrder()
    }

    const restore = async () => {
      try {
        const session = await ensureCustomerSession()
        if (cancelled || !session.customerId || !session.token) return
        const orders = await getCustomerOrders(session.customerId, session.token, 20)
        if (cancelled) return

        const stored = readActiveOrder()
        const active = pickLatestActiveOrder(orders)

        if (!active) {
          if (stored?.orderId) {
            try {
              const snapshot = await getOrder(stored.orderId, session.token)
              if (cancelled) return
              const snapshotStatus = normalizeOrderStatus(snapshot?.status)
              if (isActiveOrderStatus(snapshotStatus) && snapshot?.id) {
                setOrderId(snapshot.id)
                setCurrentOrder(snapshot)
                setStatus(snapshotStatus)
                persistActiveOrder(snapshot.id, snapshotStatus)
                if (snapshot.customerCoordinates) setPickup(snapshot.customerCoordinates)
                if (snapshot.destinationCoordinates) setDestinationPoint(snapshot.destinationCoordinates)
                setScreen((current) => {
                  if (current === "cancelled" || current === "completed") return current
                  return screenForOrderStatus(snapshotStatus)
                })
                return
              }
            } catch {
              // fall through to reset
            }
            resetToHome()
            return
          }
          clearActiveOrder()
          return
        }

        const full = orders.find((item) => item.id === active.orderId) ?? (await getOrder(active.orderId, session.token))
        if (cancelled || !full?.id) return
        const nextStatus = normalizeOrderStatus(full.status)
        if (!isActiveOrderStatus(nextStatus)) {
          resetToHome()
          return
        }
        setOrderId(full.id)
        setCurrentOrder(full)
        setStatus(nextStatus)
        persistActiveOrder(full.id, nextStatus)
        if (full.customerCoordinates) setPickup(full.customerCoordinates)
        if (full.destinationCoordinates) setDestinationPoint(full.destinationCoordinates)
        setScreen((current) => {
          if (current === "cancelled" || current === "completed") return current
          if (current !== "home" && current !== "profile" && orderId) return current
          return screenForOrderStatus(nextStatus)
        })
      } catch {
        const stored = readActiveOrder()
        if (stored?.orderId) resetToHome()
      }
    }
    void restore()
    return () => {
      cancelled = true
    }
    // Intentionally once per customer identity / mount — not on every orderId change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, customerAuthToken])

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
      if (isTerminalOrderStatus(nextStatus)) {
        if (nextStatus === "cancelled" || nextStatus === "completed") {
          clearActiveOrder()
        }
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
      if (document.visibilityState !== "visible") return
      getOrder(orderId, customerAuthToken)
        .then(applyPolledOrder)
        .catch(() => undefined)
    }

    refreshOrder()
    let pollMs = 2500
    let interval = window.setInterval(refreshOrder, pollMs)

    const setPollInterval = (ms: number) => {
      pollMs = ms
      window.clearInterval(interval)
      interval = window.setInterval(refreshOrder, pollMs)
    }

    const stopRealtime = subscribeOrderEvents(
      orderId,
      () => {
        if (!cancelled) refreshOrder()
      },
      {
        accessToken: customerAuthToken,
        onConnected: () => {
          if (!cancelled) setPollInterval(20000)
        },
        onDisconnected: () => {
          if (!cancelled) setPollInterval(2500)
        },
      },
    )

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshOrder()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", refreshOrder)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      stopRealtime()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", refreshOrder)
    }
  }, [orderId, screen, customerAuthToken])

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
    setScreen("details")
  }

  const applyOnSiteDestination = () => {
    const onSite = resolveServiceDestination(selectedService, pickup)
    setDestination(onSite.destination)
    setDestinationPoint(onSite.destinationPoint)
    setScreen("details")
  }

  const setDestinationFromMap = (point: Point) => {
    setDestinationPoint(point)
    setDestination(`Точка на карті ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`)
  }

  const submitOrder = async () => {
    if (!vehicleState.trim()) {
      setScreen("details")
      return
    }
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

  const cancelOrder = async () => {
    if (!orderId || cancelling) return
    setCancelling(true)
    setCancelError(undefined)
    try {
      await cancelOrderRequest(orderId, customerAuthToken)
      userInitiatedCancelRef.current = true
      setStatus("cancelled")
      setScreen("cancelled")
      clearActiveOrder()
    } catch {
      setCancelError("Не вдалося скасувати заявку. Спробуйте ще раз.")
    } finally {
      setCancelling(false)
    }
  }

  const retryOrderDispatch = useCallback(() => {
    if (!orderId) return
    retryDispatch(orderId, customerAuthToken)
      .then((order) => {
        setCurrentOrder(order)
        setStatus(normalizeOrderStatus(order.status))
      })
      .catch(() => undefined)
  }, [orderId, customerAuthToken])

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

  const restart = useCallback(() => {
    userInitiatedCancelRef.current = false
    setScreen("home")
    setStatus("draft")
    setOrderId(undefined)
    setCurrentOrder(undefined)
    setCustomerReviewSaving(false)
    setCustomerReviewError(undefined)
    setCustomerReviewSubmitted(false)
    setCancelError(undefined)
    setCancelling(false)
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
          const refreshed = await getOrder(orderId, customerAuthToken)
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
    else if (screen === "details") setScreen(serviceRequiresDestination(selectedService) ? "destination" : "location")
    else if (screen === "review") setScreen("details")
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
          if (destination.trim()) setScreen("details")
        } else {
          applyOnSiteDestination()
        }
        break
      case "details":
        haptic("medium")
        if (vehicleState) setScreen("review")
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
  }, [screen, haptic, verifyCustomerProfile, confirmPickupLocation, applyOnSiteDestination, destination, selectedService, vehicleState, submitOrder, startTracking, restart, customerReviewSubmitted, currentOrder?.customerReview?.rating])

  const mainButtonText = useMemo(() => {
    switch (screen) {
      case "home":
        return "Зберегти профіль"
      case "location":
        return "Підтвердити місце"
      case "destination":
        return "Далі"
      case "details":
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
    ["location", "destination", "details", "review", "assigned", "cancelled", "completed", "error"].includes(screen)
  const mainButtonEnabled =
    screen === "home" ? isCustomerProfileComplete(customerProfile) && !customerVerificationSaving :
    screen === "destination" ? (serviceRequiresDestination(selectedService) ? Boolean(destination.trim()) : true) :
    screen === "details" ? Boolean(vehicleState) :
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

  const partnerProfileOverlay = selectedPartnerProfile ? (
    <PartnerProfileSheet provider={selectedPartnerProfile} onClose={() => setSelectedPartnerProfile(null)} />
  ) : null

  const screenContent = (() => {
  switch (screen) {
    case "location":
      return (
        <LocationStep
          pickup={pickup}
          addressLabel={addressLabel}
          geoMessage={geoMessage}
          geoLoading={geoLoading}
          geoError={geoError}
          recenterTrigger={geoRecenterTrigger}
          isTelegram={isTelegram}
          onPick={(point) => applyPickup(point)}
          onRetryGeo={retryGeolocation}
          onBack={() => setScreen("home")}
          onNext={confirmPickupLocation}
          {...directoryMapProps}
        />
      )
    case "destination":
      return (
        <DestinationStep
          pickup={pickup}
          destination={destinationPoint}
          value={destination}
          serviceKey={selectedService}
          onPick={setDestinationFromMap}
          onChange={setDestination}
          onBack={() => setScreen("location")}
          onNext={() => setScreen("details")}
          onSkipOnSite={applyOnSiteDestination}
          {...directoryMapProps}
        />
      )
    case "details":
      return <DetailsStep pickup={pickup} destination={destinationPoint} value={vehicleState} onChange={setVehicleState} onBack={() => setScreen(serviceRequiresDestination(selectedService) ? "destination" : "location")} onNext={() => setScreen("review")} />
    case "review":
      return (
        <ReviewStep
          serviceLabel={serviceLabel}
          serviceKey={selectedService}
          addressLabel={addressLabel}
          destination={destination}
          pickup={pickup}
          destinationPoint={destinationPoint}
          vehicleState={vehicleState}
          customerComment={customerComment}
          onCustomerCommentChange={setCustomerComment}
          loading={loading}
          isTelegram={isTelegram}
          onConfirm={submitOrder}
          onBack={() => setScreen("details")}
          {...directoryMapProps}
        />
      )
    case "searching":
      return <SearchingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} cancelError={cancelError} cancelling={cancelling} onCancel={cancelOrder} onRetryDispatch={retryOrderDispatch} />
    case "accepted":
      return <AcceptedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} confirming={priceConfirming} confirmError={priceConfirmError} cancelError={cancelError} cancelling={cancelling} onConfirmPrice={confirmProposedPrice} onContact={contactAssignedProvider} onCancel={cancelOrder} />
    case "assigned":
      return <AssignedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} isTelegram={isTelegram} cancelError={cancelError} cancelling={cancelling} onTrack={startTracking} onCancel={cancelOrder} />
    case "tracking":
      return <TrackingStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} cancelError={cancelError} cancelling={cancelling} onCancel={cancelOrder} />
    case "arrived":
      return <ArrivedStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} cancelError={cancelError} cancelling={cancelling} onCancel={cancelOrder} />
    case "in_progress":
      return <InProgressStep orderId={orderId} status={status} order={currentOrder} pickup={pickup} destination={destinationPoint} cancelError={cancelError} cancelling={cancelling} onCancel={cancelOrder} />
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
      return <HomeStep pickup={pickup} locationLabel={addressLabel || geoMessage} serviceCity={serviceCity} providers={nearbyProviders} providersLoading={providersLoading} customerProfile={customerProfile} customerVerificationSaving={customerVerificationSaving} customerVerificationError={customerVerificationError} customerToken={customerAuthToken} isTelegram={isTelegram} geoLoading={geoLoading} geoError={geoError} recenterTrigger={geoRecenterTrigger} onProfileChange={(patch) => setCustomerProfile((profile) => ({ ...profile, ...patch }))} onVerifyCustomer={verifyCustomerProfile} onProfileVerified={(saved) => setCustomerProfile((profile) => ({ ...profile, ...saved }))} onRetryGeo={retryGeolocation} onServiceCityChange={applyServiceCity} onProviderSelect={setSelectedPartnerProfile} directoryScope={directoryScope} onDirectoryScopeChange={setDirectoryScope} directoryScopeCity={directoryScopeCity ?? undefined} directoryScopeGeoLoading={directoryScopeGeoLoading} directoryScopeGeoError={directoryScopeGeoError} onDirectoryScopeGeoRetry={retryDirectoryGeo} directoryScopeRecenterTrigger={directoryScopeRecenterTrigger} directoryScopeCityCenter={directoryScopeCityCenter ?? undefined} onSelect={(service) => { if (!isCustomerReadyForOrder(customerProfile)) return; setSelectedService(service); setDestination(""); setDestinationPoint(pickup); setScreen("location") }} />
  }
  })()

  return (
    <>
      {screenContent}
      {partnerProfileOverlay}
    </>
  )
}
