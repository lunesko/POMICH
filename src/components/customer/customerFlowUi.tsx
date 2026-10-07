import { useEffect, useState, type ReactNode } from "react"

import {
  type CustomerProfile,
  type OrderResponse,
  type ProviderAvailability,
  type VerificationStatus,
} from "../../api/client"
import {
  calculateDistanceKm,
  ON_SITE_DESTINATION_LABEL,
  serviceRequiresDestination,
  type ServiceKey,
} from "../../lib/pomichDomain"
import {
  getProfileChecklist,
  customerProfileStatusLabel,
  customerProfileStatusTone,
  isCustomerProfileComplete,
  isCustomerVerified,
  profileChecklistItemStatus,
  profileChecklistSummary,
} from "../../lib/customerProfile"
import {
  getProviderCapabilityLabel,
  toServiceKeys,
  orderStatusLabels,
  providerStatusLabel,
  verificationLabel,
  verificationTone,
  nearbyProvidersFor,
  distanceToProvider,
  type Point,
  type OrderStatus,
} from "../../lib/constants"
import { FormFooterBar } from "../layout/FormContainer"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { PhoneInput } from "../ui/PhoneInput"
import { CitySelect } from "../ui/CitySelect"
import {
  formatLocalPhoneDisplay,
  nationalDigitsFromPhone,
  phoneInputValueFromStored,
  validateUkraineMobilePhone,
} from "../../lib/ukrainePhone"
import { DEFAULT_SERVICE_CITY, normalizeServiceCity } from "../../lib/ukraineCities"
import { writeCityUserPicked, writePreferredCity } from "../../lib/preferredCity"
import {
  BRAND,
  DARK,
  BG,
  BORDER,
  MUTED,
  SUBTLE,
  CARD,
  SURFACE_TONE,
  SELECTED,
  GHOST,
} from "./customerFlowTokens"

export function VerificationPill({ status }: { status?: VerificationStatus }) {
  const tone = verificationTone(status)
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 10px", background: tone.background, border: `1px solid ${tone.border}`, color: tone.color, fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: tone.color }} />
      {verificationLabel(status)}
    </span>
  )
}

export function StepBadge({ step, total, label }: { step: number; total?: number; label: string }) {
  return (
    <div className="pomich-step-badge">
      Крок {step}{total ? ` з ${total}` : ""} · {label}
    </div>
  )
}

export function resolveServiceDestination(service: ServiceKey, pickup: Point): { destination: string; destinationPoint: Point } {
  // On-site services stay at pickup. Tow/destination services must be chosen by the user —
  // never seed a hardcoded Uzhhorod demo pin.
  if (serviceRequiresDestination(service)) {
    return { destination: "", destinationPoint: pickup }
  }
  return { destination: ON_SITE_DESTINATION_LABEL, destinationPoint: pickup }
}

export function resolveOrderDistanceKm(service: ServiceKey, pickup: Point, destinationPoint: Point): number {
  const raw = calculateDistanceKm(pickup, destinationPoint)
  return serviceRequiresDestination(service) ? raw : Math.max(0.5, raw)
}

export function PrimaryButton({
  label,
  onClick,
  loading = false,
  loadingLabel,
  disabled = false,
}: {
  label: string
  onClick?: () => void
  loading?: boolean
  loadingLabel?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`pomich-primary-btn${disabled || loading ? " is-disabled" : ""}`}
    >
      {loading ? (loadingLabel ?? label) : label}
    </button>
  )
}

export function SecondaryButton({ label, onClick, danger = false, disabled = false }: { label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
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

export function StatusPill({ status }: { status: OrderStatus }) {
  const cancelled = status === "cancelled"
  return (
    <div className={`pomich-status-pill ${cancelled ? "pomich-status-pill--cancelled" : "pomich-status-pill--active"}`}>
      <span className="pomich-status-pill__dot" />
      {orderStatusLabels[status]}
    </div>
  )
}

export function Timeline({ status }: { status: OrderStatus }) {
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

export function ProviderCard({
  orderId,
  eta,
  assignedProvider,
  fallbackName,
}: {
  orderId?: string
  eta?: number
  assignedProvider?: OrderResponse["assignedProvider"] | ProviderAvailability
  fallbackName?: string
}) {
  const cardProvider = assignedProvider
  if (!cardProvider) {
    return (
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
        <div style={{ fontWeight: 900, color: DARK }}>{fallbackName ?? "Партнер прийняв заявку"}</div>
        <div style={{ color: MUTED, fontWeight: 700, marginTop: 6, fontSize: 13 }}>Завантажуємо дані виконавця…</div>
      </div>
    )
  }
  const phone = cardProvider.phone
  const telegram = cardProvider.telegram
  const rating = cardProvider.rating
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
        {phone ? (
          <SecondaryButton label="📞 Подзвонити" onClick={() => { window.location.href = `tel:${phone}` }} />
        ) : null}
        {telegram ? (
          <SecondaryButton
            label="💬 Чат"
            onClick={() => {
              window.open(`https://t.me/${telegram}${orderId ? `?start=order_${orderId}` : ""}`, "_blank", "noopener,noreferrer")
            }}
          />
        ) : null}
      </div>
      {eta ? <div style={{ marginTop: 10, color: MUTED, fontSize: 13, fontWeight: 700 }}>Прибуття приблизно за {eta} хв</div> : null}
      {distanceLabel ? <div style={{ marginTop: 6, color: MUTED, fontSize: 13, fontWeight: 700 }}>{distanceLabel}</div> : null}
    </div>
  )
}

export function ScreenLayout({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="pomich-themed-shell pomich-screen-layout" style={{ width: "100%", maxWidth: "100%", minWidth: 0, height: "100%", minHeight: "100%", display: "flex", flexDirection: "column", overflowX: "hidden" }}>
      <div className="pomich-screen-layout__content" style={{ flex: 1, minWidth: 0, overflow: "auto", overflowX: "hidden" }}>{children}</div>
      {footer ? <FormFooterBar>{footer}</FormFooterBar> : null}
    </div>
  )
}

export function StepBack({ onBack, hide = false }: { onBack: () => void; hide?: boolean }) {
  if (hide) return null
  return (
    <button type="button" onClick={onBack} className="pomich-step-back">← Назад</button>
  )
}

export function SheetHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h2 className="pomich-sheet-heading__title" style={{ margin: 0 }}>{title}</h2>
      {subtitle ? <p className="pomich-sheet-heading__subtitle" style={{ margin: "4px 0 0" }}>{subtitle}</p> : null}
    </div>
  )
}

export function LocationRow({ icon, title, subtitle, active = false }: { icon: string; title: string; subtitle: string; active?: boolean }) {
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

export function SheetDivider() {
  return <div style={{ height: 1, background: BORDER, margin: "4px 0" }} />
}

export function GeoRefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Оновити геолокацію"
      aria-busy={loading || undefined}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      style={{
        minHeight: 36,
        padding: "0 12px",
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        background: loading ? GHOST : CARD,
        color: loading ? SUBTLE : DARK,
        fontWeight: 900,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        touchAction: "manipulation",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{loading ? "…" : "↻"}</span>
      {loading ? "Оновлюємо…" : "Оновити"}
    </button>
  )
}

export function CurrentLocationCard({
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

export function AvailabilityPanel({ pickup, providers, loading }: { pickup: Point; providers: ProviderAvailability[]; loading: boolean }) {
  const nearby = nearbyProvidersFor(pickup, providers)
  const nearest = nearby[0]

  return (
    <div style={{ background: CARD, borderRadius: 14, border: `1px solid ${BORDER}`, padding: "10px 12px", display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 950, color: DARK, fontSize: 14 }}>{loading ? "Перевіряємо партнерів" : nearby.length > 0 ? `${nearby.length} на лінії поруч` : "Партнерів поруч не видно"}</div>
          <div style={{ color: MUTED, fontWeight: 700, fontSize: 11, marginTop: 2, lineHeight: 1.35 }}>
            {nearest
              ? typeof nearest.etaMinutes === "number"
                ? `Найближчий: ${nearest.name} · ~${nearest.etaMinutes} хв`
                : `Найближчий: ${nearest.name} · ${distanceToProvider(pickup, nearest).toFixed(1)} км`
              : "Можна створити заявку — диспетчер підключить вручну."}
          </div>
        </div>
        <div style={{ borderRadius: 999, padding: "5px 8px", background: nearby.length > 0 ? SELECTED : "var(--pomich-warn-bg)", color: nearby.length > 0 ? BRAND : "var(--pomich-warn-text)", fontSize: 11, fontWeight: 950 }}>
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
              <div style={{ color: BRAND, fontWeight: 950, whiteSpace: "nowrap" }}>
                {typeof item.etaMinutes === "number"
                  ? `~${item.etaMinutes} хв`
                  : `${distanceToProvider(pickup, item).toFixed(1)} км`}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function CustomerTrustPanel({
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
        <label className="pomich-form-field">
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Ім'я *</span>
          <input value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} placeholder="Ваше ім'я" className="pomich-form-input" style={{ color: DARK }} />
        </label>
        <label className="pomich-form-field">
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Телефон *</span>
          <PhoneInput value={draft.phone} onChange={(phone) => patchDraft({ phone })} />
        </label>
        <label className="pomich-form-field">
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 850 }}>Email</span>
          <input value={draft.email} onChange={(event) => patchDraft({ email: event.target.value })} inputMode="email" placeholder="email@example.com" className="pomich-form-input" style={{ color: DARK }} />
        </label>
        <CitySelect
          value={draft.city || profile.city || DEFAULT_SERVICE_CITY}
          onChange={(city) => {
            patchDraft({ city })
            writePreferredCity(city)
            writeCityUserPicked(true)
          }}
          label="Місто для довідника СТО/АЗС"
        />
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 14, padding: 12, background: SURFACE_TONE }}>
        <div style={{ fontWeight: 950, fontSize: 13, color: DARK, marginBottom: 8 }}>{profileChecklistSummary({ ...profile, ...draft })}</div>
        <div className="pomich-form-field">
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

