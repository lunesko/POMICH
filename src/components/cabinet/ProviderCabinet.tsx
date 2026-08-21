import { useCallback, useEffect, useMemo, useState } from "react"

import {
  createSelfProviderSession,
  getProviderOffers,
  getProviderOrders,
  getProviderProfile,
  messageFromFetchError,
  updateProviderPresence,
  updateProviderProfile,
  type AuthSession,
  type CustomerProfile,
  type DispatchOffer,
  type OrderResponse,
  type ProviderAvailability,
} from "../../api/client"
import {
  BRAND,
  DEFAULT_SERVICE_RADIUS_KM,
  getServiceEmoji,
  getServiceLabel,
  isProviderPhoneVerified,
  services,
  toServiceKeys,
} from "../../lib/constants"
import type { ServiceKey } from "../../lib/pomichDomain"
import { readCachedProviderProfile, writeCachedProviderProfile } from "../../lib/providerProfileCache"
import { roleLabel, readBootstrapProfile, resolveProviderIdForCustomer, storeLinkedProviderId, type UserRole } from "../../lib/userAccount"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { validateUkrainePlate } from "../../lib/ukrainePlate"
import { isPartnerProfileIncomplete } from "../../lib/partnerProfileComplete"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
import { writeCityUserPicked, writePreferredCity } from "../../lib/preferredCity"
import { validatePersonName } from "../../lib/personName"
import { authSessionStorageKey, isAuthSessionToken, readAuthSessionSubject, readStoredAuthSession, readStoredCustomerAuthSession, storeAuthSession } from "../../lib/auth"
import { presenceErrorMessage } from "../ui/DutyStatusToggle"
import { getTelegramContext } from "../../telegram"
import { Header } from "../layout/Header"
import { formatCabinetOrderStatus, formatCabinetReviewStars } from "../customer/OrderTerminalStep"
import { CitySelect } from "../ui/CitySelect"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { PhoneInput } from "../ui/PhoneInput"
import { UkrainePlateInput } from "../ui/UkrainePlateInput"
import { PrimaryButton } from "../ui/PrimaryButton"
import { ServiceRadiusField } from "../ui/ServiceRadiusField"
import { VerificationPill } from "../ui/VerificationPill"

interface ProviderCabinetProps {
  providerId: string
  providerToken?: string
  /** Warm-start from ProviderFlow / session cache — avoids blank 15s wait on open. */
  initialProfile?: ProviderAvailability
  currentRole: UserRole
  /** Open directly in profile edit mode (e.g. incomplete profile bootstrap). */
  initialEditing?: boolean
  onBack: () => void
  onSwitchRole: () => void
  onLogout?: () => void
}

const PROFILE_LOAD_TIMEOUT_MS = 2000
const SECONDARY_DATA_DEFER_MS = 50

function hasDisplayableProviderProfile(profile?: ProviderAvailability): boolean {
  if (!profile) return false
  const name = profile.name?.trim()
  if (name && name !== "Партнер POMICH") return true
  if (profile.phone?.trim()) return true
  if (profile.vehicle?.trim()) return true
  return toServiceKeys(profile.specialties).length > 0
}

function ProviderCabinetProfileSkeleton() {
  return (
    <div className="pomich-cabinet-card pomich-cabinet-card--profile">
      <div className="pomich-cabinet-profile pomich-cabinet-profile--skeleton" aria-hidden="true">
        <div className="pomich-cabinet-avatar pomich-cabinet-skeleton-block" />
        <div className="pomich-cabinet-profile-meta">
          <div className="pomich-cabinet-skeleton-line pomich-cabinet-skeleton-line--title" />
          <div className="pomich-cabinet-skeleton-line" />
          <div className="pomich-cabinet-skeleton-line pomich-cabinet-skeleton-line--short" />
        </div>
      </div>
    </div>
  )
}

function isProviderOnline(profile?: Pick<ProviderAvailability, "status">): boolean {
  return profile?.status === "online" || profile?.status === "busy"
}

function buildStubProviderProfile(providerId: string): ProviderAvailability {
  const bootstrap = readBootstrapProfile()
  const name = bootstrap?.name?.trim() && bootstrap.name !== "Партнер POMICH" ? bootstrap.name.trim() : ""
  return {
    id: providerId,
    name,
    phone: bootstrap?.phone?.trim() || "",
    vehicle: "",
    plate: "",
    city: bootstrap?.city?.trim() || "",
    status: "offline",
    verificationStatus: bootstrap?.verificationStatus || "unverified",
    specialties: [],
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
  }
}

function profileToForm(profile: ProviderAvailability) {
  return {
    name: profile.name?.trim() && profile.name !== "Партнер POMICH" ? profile.name : "",
    phone: profile.phone || "",
    city: profile.city || "",
    vehicle: profile.vehicle || "",
    plate: profile.plate || "",
    specialties: toServiceKeys(profile.specialties),
    serviceRadiusKm: profile.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM,
  }
}

export default function ProviderCabinet({
  providerId,
  providerToken,
  initialProfile,
  currentRole,
  initialEditing = false,
  onBack,
  onSwitchRole,
  onLogout,
}: ProviderCabinetProps) {
  const seededProfile = initialProfile ?? readCachedProviderProfile(providerId)
  const [profile, setProfile] = useState<ProviderAvailability | undefined>(() => {
    if (seededProfile) return seededProfile
    if (initialEditing) return undefined
    return buildStubProviderProfile(providerId)
  })
  const [offers, setOffers] = useState<DispatchOffer[]>([])
  const [orderHistory, setOrderHistory] = useState<OrderResponse[]>([])
  const [offersLoading, setOffersLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState<string>()
  const [profileLoading, setProfileLoading] = useState(() => !hasDisplayableProviderProfile(seededProfile))
  const [loadError, setLoadError] = useState<string>()
  const [editing, setEditing] = useState(initialEditing)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [saveSuccess, setSaveSuccess] = useState<string>()
  const [phoneError, setPhoneError] = useState<string>()
  const [dutySaving, setDutySaving] = useState(false)
  const [dutyError, setDutyError] = useState<string>()
  const [form, setForm] = useState(() => {
    const seed = initialProfile ?? readCachedProviderProfile(providerId)
    return seed ? profileToForm(seed) : {
      name: "",
      phone: "",
      city: "",
      vehicle: "",
      plate: "",
      specialties: [] as ServiceKey[],
      serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
    }
  })

  const telegramContext = useMemo(() => getTelegramContext(), [])
  const customerIdForOtp =
    (typeof window !== "undefined" ? readStoredCustomerAuthSession({ telegramChatId: telegramContext.chatId })?.customerId : undefined) ??
    (typeof window !== "undefined"
      ? window.sessionStorage.getItem("pomichCustomerId") || window.localStorage.getItem("pomichCustomerId")
      : null)
  const customerTokenForOtp =
    (customerIdForOtp
      ? readStoredAuthSession(authSessionStorageKey("customer", customerIdForOtp), "customer", customerIdForOtp)
      : undefined) ??
    (typeof window !== "undefined" && customerIdForOtp
      ? readStoredCustomerAuthSession({ telegramChatId: telegramContext.chatId })?.token
      : undefined)
  const [activeProviderId, setActiveProviderId] = useState(providerId)
  const [activeProviderToken, setActiveProviderToken] = useState(providerToken)

  useEffect(() => {
    setActiveProviderId(providerId)
  }, [providerId])

  useEffect(() => {
    setActiveProviderToken(providerToken)
  }, [providerToken])

  const applyProviderSession = useCallback((session: AuthSession) => {
    const resolvedId = String(session.providerId || session.subjectId || activeProviderId).trim() || activeProviderId
    if (resolvedId) storeLinkedProviderId(resolvedId)
    storeAuthSession(authSessionStorageKey("provider", resolvedId), session)
    setActiveProviderId(resolvedId)
    setActiveProviderToken(session.accessToken)
    return { token: session.accessToken, providerId: resolvedId }
  }, [activeProviderId])

  const ensureProviderSession = useCallback(async () => {
    if (activeProviderToken && isAuthSessionToken(activeProviderToken)) {
      const subject = readAuthSessionSubject(activeProviderToken) || activeProviderId
      if (subject && subject !== activeProviderId) {
        setActiveProviderId(subject)
        storeLinkedProviderId(subject)
      } else if (subject) {
        storeLinkedProviderId(subject)
      }
      return { token: activeProviderToken, providerId: subject }
    }

    const customerId =
      customerIdForOtp ||
      (typeof window !== "undefined"
        ? window.sessionStorage.getItem("pomichCustomerId") || window.localStorage.getItem("pomichCustomerId")
        : null)
    const customerToken =
      customerTokenForOtp ||
      (customerId
        ? readStoredAuthSession(authSessionStorageKey("customer", customerId), "customer", customerId)
        : undefined)

    if (customerId && customerToken) {
      const linkedId = resolveProviderIdForCustomer(customerId)
      if (linkedId) storeLinkedProviderId(linkedId)
      try {
        const session = await createSelfProviderSession(customerId, customerToken)
        return applyProviderSession(session)
      } catch {
        // Fall through to missing-session error below.
      }
    }

    throw Object.assign(new Error("provider_session_missing"), { detail: "provider_session_missing" })
  }, [activeProviderId, activeProviderToken, applyProviderSession, customerIdForOtp, customerTokenForOtp])

  const refreshProfile = useCallback(async (overrideId?: string, overrideToken?: string) => {
    const targetId = overrideId || activeProviderId
    const targetToken = overrideToken || activeProviderToken
    try {
      const loaded = await getProviderProfile(targetId, targetToken)
      setProfile(loaded)
      writeCachedProviderProfile(loaded)
      setLoadError(undefined)
      if (isPartnerProfileIncomplete(loaded) && !initialEditing) {
        setEditing(true)
      }
      return loaded
    } catch {
      let resolved!: ProviderAvailability
      setProfile((current) => {
        resolved = current ?? buildStubProviderProfile(targetId)
        return resolved
      })
      setLoadError(undefined)
      if (isPartnerProfileIncomplete(resolved) && !initialEditing) {
        setEditing(true)
      }
      return resolved
    }
  }, [activeProviderId, activeProviderToken, initialEditing])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      if (!cancelled) setProfileLoading(false)
    }, PROFILE_LOAD_TIMEOUT_MS)

    const loadProfile = async () => {
      try {
        const session = await ensureProviderSession().catch(() => undefined)
        const targetId = session?.providerId || activeProviderId
        const targetToken = session?.token || activeProviderToken
        await refreshProfile(targetId, targetToken)
      } catch {
        if (!cancelled) {
          const stub = buildStubProviderProfile(activeProviderId)
          setProfile((current) => current ?? stub)
          setLoadError(undefined)
          if (!initialEditing) setEditing(true)
        }
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }

    void loadProfile()
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [activeProviderId, activeProviderToken, ensureProviderSession, initialEditing, refreshProfile])

  useEffect(() => {
    let cancelled = false
    const defer = window.setTimeout(() => {
      void (async () => {
        try {
          const session = await ensureProviderSession().catch(() => undefined)
          const targetId = session?.providerId || activeProviderId
          const targetToken = session?.token || activeProviderToken
          if (!targetToken) {
            if (!cancelled) {
              setOffersLoading(false)
            }
            return
          }

          if (!cancelled) setOffersLoading(true)
          const nextOffers = await getProviderOffers(targetId, targetToken).catch(() => [])
          if (!cancelled) {
            setOffers(Array.isArray(nextOffers) ? nextOffers : [])
            setOffersLoading(false)
          }

          if (!cancelled) setOrdersLoading(true)
          const nextOrders = await getProviderOrders(targetId, targetToken).catch(() => {
            if (!cancelled) setOrdersError("Не вдалося завантажити історію заявок.")
            return []
          })
          if (!cancelled) {
            setOrderHistory(Array.isArray(nextOrders) ? nextOrders : [])
            if (Array.isArray(nextOrders)) setOrdersError(undefined)
            setOrdersLoading(false)
          }
        } catch {
          if (!cancelled) {
            setOffersLoading(false)
            setOrdersLoading(false)
          }
        }
      })()
    }, SECONDARY_DATA_DEFER_MS)

    const interval = window.setInterval(() => {
      void (async () => {
        const session = await ensureProviderSession().catch(() => undefined)
        const targetId = session?.providerId || activeProviderId
        const targetToken = session?.token || activeProviderToken
        if (!targetToken) return
        refreshProfile(targetId, targetToken).catch(() => undefined)
        getProviderOrders(targetId, targetToken)
          .then((nextOrders) => {
            if (!cancelled) {
              setOrderHistory(Array.isArray(nextOrders) ? nextOrders : [])
              setOrdersError(undefined)
            }
          })
          .catch(() => undefined)
      })()
    }, 12000)

    return () => {
      cancelled = true
      window.clearTimeout(defer)
      window.clearInterval(interval)
    }
  }, [activeProviderId, activeProviderToken, ensureProviderSession, refreshProfile])

  useEffect(() => {
    if (!profile) return
    // Always keep the edit form aligned with the loaded profile while entering/staying in edit.
    // Previous logic skipped sync whenever editing=true, so initialEditing / auto-incomplete
    // opened a blank form and «Зберегти» looked dead (validation fired on empty fields).
    if (editing) {
      setForm((current) => {
        const next = profileToForm(profile)
        const currentEmpty =
          !current.name.trim() &&
          !current.phone.trim() &&
          !current.vehicle.trim() &&
          !current.plate.trim() &&
          current.specialties.length === 0
        return currentEmpty ? next : current
      })
      return
    }
    setForm(profileToForm(profile))
  }, [profile, editing])

  useEffect(() => {
    if (!saveSuccess) return
    const timeout = window.setTimeout(() => setSaveSuccess(undefined), 4000)
    return () => window.clearTimeout(timeout)
  }, [saveSuccess])

  const profileVerified = isProviderPhoneVerified(profile)
  const isOnline = isProviderOnline(profile)
  const name = profile?.name?.trim() || "Партнер POMICH"

  const openEdit = () => {
    if (profile) setForm(profileToForm(profile))
    setSaveError(undefined)
    setSaveSuccess(undefined)
    setPhoneError(undefined)
    setEditing(true)
  }

  const toggleSpecialty = (specialty: ServiceKey) => {
    setForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(specialty)
        ? prev.specialties.filter((item) => item !== specialty)
        : [...prev.specialties, specialty],
    }))
  }

  const handleSave = async () => {
    const nameValidation = validatePersonName(form.name)
    const phoneValidation = validateUkraineMobilePhone(form.phone)
    const cityValidation = validateServiceCity(form.city || DEFAULT_SERVICE_CITY)
    if (!nameValidation.valid) {
      setSaveSuccess(undefined)
      setSaveError(nameValidation.error || "Введіть ім'я")
      return
    }
    if (!phoneValidation.valid) {
      setSaveSuccess(undefined)
      setPhoneError(phoneValidation.error)
      setSaveError(phoneValidation.error || "Вкажіть коректний телефон")
      return
    }
    if (!cityValidation.valid) {
      setSaveSuccess(undefined)
      setSaveError(cityValidation.error || "Оберіть місто")
      return
    }
    if (!form.vehicle.trim()) {
      setSaveSuccess(undefined)
      setSaveError("Вкажіть авто")
      return
    }
    const plateValidation = validateUkrainePlate(form.plate)
    if (!plateValidation.valid) {
      setSaveSuccess(undefined)
      setSaveError(plateValidation.error || "Вкажіть коректний номер авто")
      return
    }
    if (form.specialties.length === 0) {
      setSaveSuccess(undefined)
      setSaveError("Оберіть хоча б одну послугу")
      return
    }

    setSaving(true)
    setSaveError(undefined)
    setSaveSuccess(undefined)
    setPhoneError(undefined)
    try {
      const session = await ensureProviderSession()
      const saved = await updateProviderProfile(
        session.providerId,
        {
          name: nameValidation.value,
          phone: phoneValidation.e164,
          city: cityValidation.value,
          vehicle: form.vehicle.trim(),
          telegram: profile?.telegram,
          plate: plateValidation.plate,
          specialties: form.specialties,
          serviceRadiusKm: form.serviceRadiusKm,
          location: profile?.location,
        },
        session.token,
      )
      const merged = { ...(profile ?? saved), ...saved, specialties: toServiceKeys(saved.specialties) }
      setProfile(merged)
      writeCachedProviderProfile({ ...merged, id: session.providerId })
      writePreferredCity(cityValidation.value)
      writeCityUserPicked(true)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(`pomichPartnerRegistered:${session.providerId}`, "1")
      }
      setLoadError(undefined)
      setSaveSuccess("Профіль збережено")
      setEditing(false)
    } catch (err) {
      const message = messageFromFetchError(err, "Не вдалося зберегти профіль. Спробуйте ще раз.")
      if (message.includes("номер") || message.includes("phone_already")) {
        setPhoneError(message)
        setSaveError(message)
      } else {
        setSaveError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  const toggleDuty = async () => {
    if (!profileVerified && !isOnline) {
      setDutyError("Підтвердіть телефон кодом у Telegram, щоб вийти на лінію.")
      return
    }
    if (!isOnline && isPartnerProfileIncomplete(profile)) {
      setDutyError("Спочатку заповніть профіль партнера (авто, номер і послуги).")
      setEditing(true)
      return
    }

    setDutySaving(true)
    setDutyError(undefined)
    try {
      const session = await ensureProviderSession()
      const updated = await updateProviderPresence(
        session.providerId,
        {
          status: isOnline ? "offline" : "online",
          location: profile?.location,
          etaMinutes: profile?.etaMinutes,
        },
        session.token,
      )
      setProfile((prev) => ({ ...(prev ?? updated), ...updated }))
    } catch (err) {
      const detail = (err as { detail?: string }).detail
      setDutyError(
        typeof detail === "string"
          ? presenceErrorMessage(detail)
          : err instanceof Error
            ? presenceErrorMessage(err.message)
            : presenceErrorMessage(undefined),
      )
    } finally {
      setDutySaving(false)
    }
  }

  const otpProfile: CustomerProfile = {
    id: customerIdForOtp || providerId,
    name: profile?.name || form.name,
    phone: profile?.phone || form.phone,
    verificationStatus: profile?.verificationStatus,
  }

  return (
    <div className="pomich-cabinet-shell">
      <div className="pomich-cabinet-header">
        <Header
          title="Кабінет партнера"
          subtitle={`${roleLabel(currentRole)} · POMICH`}
          onBack={onBack}
          compactToggle
          actions={
            <>
              <button type="button" onClick={onSwitchRole} className="pomich-cabinet-chip-btn">
                Змінити роль
              </button>
              {onLogout ? (
                <button type="button" onClick={onLogout} className="pomich-cabinet-chip-btn pomich-cabinet-chip-btn--muted">
                  Вийти
                </button>
              ) : null}
            </>
          }
        />
      </div>

      <div className="pomich-cabinet-body">
        <div className="pomich-cabinet-inner">
          {loadError ? <div className="pomich-form-error">{loadError}</div> : null}
          {profileLoading && !hasDisplayableProviderProfile(profile) && !editing ? (
            <ProviderCabinetProfileSkeleton />
          ) : (
            <>
              <div className="pomich-cabinet-card">
                {editing ? (
                  <div className="pomich-cabinet-edit-form">
                    <div className="pomich-cabinet-section-title">Редагування профілю</div>
                    <label className="pomich-cabinet-field">
                      <span className="pomich-form-label">Ім'я *</span>
                      <input
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="Ваше ім'я"
                        className="pomich-form-input"
                      />
                    </label>
                    <label className="pomich-cabinet-field">
                      <span className="pomich-form-label">Телефон *</span>
                      <PhoneInput
                        value={form.phone}
                        onChange={(next) => {
                          setForm((prev) => ({ ...prev, phone: next }))
                          if (phoneError) setPhoneError(undefined)
                        }}
                        error={phoneError}
                      />
                    </label>
                    <CitySelect
                      value={form.city || DEFAULT_SERVICE_CITY}
                      onChange={(city) => setForm((prev) => ({ ...prev, city }))}
                      label="Оберіть місто"
                    />
                    <label className="pomich-cabinet-field">
                      <span className="pomich-form-label">Авто *</span>
                      <input
                        value={form.vehicle}
                        onChange={(event) => setForm((prev) => ({ ...prev, vehicle: event.target.value }))}
                        placeholder="Volkswagen Crafter"
                        className="pomich-form-input"
                      />
                    </label>
                    <label className="pomich-cabinet-field">
                      <span className="pomich-form-label">Номер авто *</span>
                      <UkrainePlateInput
                        value={form.plate}
                        onChange={(plate) => setForm((prev) => ({ ...prev, plate }))}
                      />
                    </label>
                    <div className="pomich-cabinet-field">
                      <span className="pomich-form-label">Послуги *</span>
                      <div className="pomich-cabinet-service-grid">
                        {services.map((service) => {
                          const selected = form.specialties.includes(service.key)
                          return (
                            <button
                              key={service.key}
                              type="button"
                              onClick={() => toggleSpecialty(service.key)}
                              className={`pomich-cabinet-service-chip${selected ? " is-selected" : ""}`}
                            >
                              {service.emoji} {service.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <ServiceRadiusField
                      value={form.serviceRadiusKm}
                      onChange={(serviceRadiusKm) => setForm((prev) => ({ ...prev, serviceRadiusKm }))}
                    />
                    {saveError ? <div className="pomich-form-error" role="alert">{saveError}</div> : null}
                    {!profileVerified ? (
                      <OtpVerificationPanel
                        profile={otpProfile}
                        customerToken={customerTokenForOtp}
                        isTelegram={telegramContext.isTelegram}
                        phone={form.phone}
                        compact
                        onVerified={async () => {
                          const refreshed = await refreshProfile()
                          if (refreshed) {
                            setProfile(refreshed)
                          } else {
                            setProfile((prev) => (
                              prev
                                ? { ...prev, verificationStatus: "verified", verification: { ...prev.verification, phone: true } }
                                : prev
                            ))
                          }
                        }}
                      />
                    ) : null}
                    <div className="pomich-cabinet-edit-actions">
                      <button type="button" onClick={() => setEditing(false)} className="pomich-cabinet-chip-btn" disabled={saving}>
                        Скасувати
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pomich-cabinet-profile">
                    <div className="pomich-cabinet-avatar" aria-hidden="true">
                      {name.trim().slice(0, 1).toUpperCase()}
                    </div>
                    <div className="pomich-cabinet-profile-meta">
                      <div className="pomich-cabinet-profile-name">{name}</div>
                      <div className="pomich-cabinet-profile-phone">{profile?.phone || "Телефон не вказано"}</div>
                      {profile?.city ? <div className="pomich-cabinet-profile-extra">{profile.city}</div> : null}
                      {profile?.vehicle ? <div className="pomich-cabinet-profile-extra">{profile.vehicle}</div> : null}
                      {profile?.plate ? <div className="pomich-cabinet-profile-extra">{profile.plate}</div> : null}
                      {profile?.specialties?.length ? (
                        <div className="pomich-cabinet-profile-extra">
                          {toServiceKeys(profile.specialties).map((key) => `${getServiceEmoji(key)} ${services.find((item) => item.key === key)?.label ?? key}`).join(" · ")}
                        </div>
                      ) : null}
                      <div className="pomich-cabinet-profile-badges">
                        {!profileVerified ? <VerificationPill status={profile?.verificationStatus} /> : null}
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            borderRadius: 999,
                            padding: "6px 10px",
                            background: isOnline ? "var(--pomich-selected-bg)" : "var(--pomich-service-tone-default)",
                            color: isOnline ? BRAND : "var(--pomich-muted)",
                            fontSize: 12,
                            fontWeight: 900,
                            border: "1px solid var(--pomich-border)",
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: 999, background: isOnline ? BRAND : "var(--pomich-subtle)" }} />
                          {isOnline ? "На лінії" : "Поза лінією"}
                        </span>
                      </div>
                    </div>
                    <button type="button" onClick={openEdit} className="pomich-cabinet-chip-btn">
                      Редагувати
                    </button>
                  </div>
                )}
              </div>

              {!profileVerified && !editing && profile?.phone?.trim() ? (
                <div className="pomich-cabinet-card pomich-cabinet-verification-help">
                  <OtpVerificationPanel
                    profile={otpProfile}
                    customerToken={customerTokenForOtp}
                    isTelegram={telegramContext.isTelegram}
                    onVerified={async () => {
                      const refreshed = await refreshProfile()
                      if (refreshed) setProfile(refreshed)
                    }}
                  />
                </div>
              ) : null}

              <div className="pomich-cabinet-card">
                <div className="pomich-cabinet-section-title">Вхідні заявки</div>
                {offersLoading ? (
                  <div className="pomich-cabinet-empty">Завантажуємо заявки…</div>
                ) : offers.length === 0 ? (
                  <div className="pomich-cabinet-empty">
                    Ще немає вхідних заявок. Вийдіть на лінію, щоб бачити нові оффери поруч.
                  </div>
                ) : (
                  offers.map((offer) => (
                    <div key={offer.id} className="pomich-cabinet-order-item">
                      <div className="pomich-cabinet-order-title">
                        {offer.service || "Послуга"} · {offer.distanceKm?.toFixed(1) ?? "—"} км
                      </div>
                      <div className="pomich-cabinet-order-status">{offer.status}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="pomich-cabinet-card">
                <div className="pomich-cabinet-section-title">Історія заявок</div>
                {ordersLoading && orderHistory.length === 0 ? (
                  <div className="pomich-cabinet-empty">Завантажуємо історію…</div>
                ) : ordersError && orderHistory.length === 0 ? (
                  <div className="pomich-form-error">{ordersError}</div>
                ) : orderHistory.length === 0 ? (
                  <div className="pomich-cabinet-empty">
                    Ще немає виконаних або скасованих заявок у вашій історії.
                  </div>
                ) : (
                  orderHistory.map((order) => {
                    const ownReview = formatCabinetReviewStars(order.partnerReview?.rating)
                    const clientReview = formatCabinetReviewStars(order.customerReview?.rating)
                    const clientName = order.customerName
                    return (
                      <div key={order.id || `${order.createdAt}-${order.status}`} className="pomich-cabinet-order-item">
                        <div className="pomich-cabinet-order-title">
                          {getServiceLabel(order.service)} · #{order.id || "—"}
                        </div>
                        <div className="pomich-cabinet-order-status">{formatCabinetOrderStatus(order.status)}</div>
                        {typeof order.partnerProposedPrice === "number" ? (
                          <div className="pomich-cabinet-order-meta">{order.partnerProposedPrice.toLocaleString("uk-UA")} ₴</div>
                        ) : null}
                        {clientName ? (
                          <div className="pomich-cabinet-order-meta">Клієнт: {clientName}</div>
                        ) : null}
                        {ownReview ? (
                          <div className="pomich-cabinet-order-meta">Ваша оцінка клієнта: {ownReview}</div>
                        ) : null}
                        {clientReview ? (
                          <div className="pomich-cabinet-order-meta">Оцінка від клієнта: {clientReview}</div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="pomich-cabinet-footer">
        <div className="pomich-cabinet-footer-inner">
          {editing ? (
            <>
              {saveError ? <div className="pomich-form-error" role="alert" style={{ marginBottom: 10 }}>{saveError}</div> : null}
              {saveSuccess ? <div className="pomich-form-success" role="status" style={{ marginBottom: 10 }}>{saveSuccess}</div> : null}
              <PrimaryButton
                label={saving ? "Зберігаємо…" : "Зберегти"}
                onClick={() => void handleSave()}
                disabled={saving}
              />
            </>
          ) : (
            <>
              {dutyError ? <div className="pomich-form-error" role="alert" style={{ marginBottom: 10 }}>{dutyError}</div> : null}
              {saveSuccess ? <div className="pomich-form-success" role="status" style={{ marginBottom: 10 }}>{saveSuccess}</div> : null}
              <PrimaryButton
                label={
                  dutySaving
                    ? "Оновлюємо статус…"
                    : isOnline
                      ? "Піти з лінії"
                      : !profileVerified
                        ? "Підтвердити телефон"
                        : "Вийти на лінію"
                }
                onClick={() => void toggleDuty()}
                disabled={dutySaving || (profileLoading && !hasDisplayableProviderProfile(profile))}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
