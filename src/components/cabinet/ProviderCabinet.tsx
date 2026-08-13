import { useCallback, useEffect, useMemo, useState } from "react"

import {
  createSelfProviderSession,
  getProviderOffers,
  getProviderOrders,
  getProviderProfile,
  getProviders,
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
import { roleLabel, resolveProviderIdForCustomer, storeLinkedProviderId, type UserRole } from "../../lib/userAccount"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../lib/ukraineCities"
import { validatePersonName } from "../../lib/personName"
import { authSessionStorageKey, isAuthSessionToken, readAuthSessionSubject, readStoredAuthSession, storeAuthSession } from "../../lib/auth"
import { presenceErrorMessage } from "../ui/DutyStatusToggle"
import { getTelegramContext } from "../../telegram"
import { Header } from "../layout/Header"
import { formatCabinetOrderStatus, formatCabinetReviewStars } from "../customer/OrderTerminalStep"
import { CitySelect } from "../ui/CitySelect"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import { PhoneInput } from "../ui/PhoneInput"
import { PrimaryButton } from "../ui/PrimaryButton"
import { ServiceRadiusField } from "../ui/ServiceRadiusField"
import { VerificationPill } from "../ui/VerificationPill"

interface ProviderCabinetProps {
  providerId: string
  providerToken?: string
  currentRole: UserRole
  onBack: () => void
  onSwitchRole: () => void
  onLogout?: () => void
}

function isProviderOnline(profile?: Pick<ProviderAvailability, "status">): boolean {
  return profile?.status === "online" || profile?.status === "busy"
}

function profileToForm(profile: ProviderAvailability) {
  return {
    name: profile.name?.trim() && profile.name !== "Партнер POMICH" ? profile.name : "",
    phone: profile.phone || "",
    city: profile.city || "",
    vehicle: profile.vehicle || "",
    specialties: toServiceKeys(profile.specialties),
    serviceRadiusKm: profile.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM,
  }
}

export default function ProviderCabinet({
  providerId,
  providerToken,
  currentRole,
  onBack,
  onSwitchRole,
  onLogout,
}: ProviderCabinetProps) {
  const [profile, setProfile] = useState<ProviderAvailability | undefined>()
  const [offers, setOffers] = useState<DispatchOffer[]>([])
  const [orderHistory, setOrderHistory] = useState<OrderResponse[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [phoneError, setPhoneError] = useState<string>()
  const [dutySaving, setDutySaving] = useState(false)
  const [dutyError, setDutyError] = useState<string>()
  const [form, setForm] = useState(() => ({
    name: "",
    phone: "",
    city: "",
    vehicle: "",
    specialties: [] as ServiceKey[],
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
  }))

  const telegramContext = useMemo(() => getTelegramContext(), [])
  const customerIdForOtp = typeof window !== "undefined" ? window.sessionStorage.getItem("pomichCustomerId") : null
  const customerTokenForOtp = customerIdForOtp
    ? readStoredAuthSession(authSessionStorageKey("customer", customerIdForOtp), "customer", customerIdForOtp)
    : undefined
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
      }
      return { token: activeProviderToken, providerId: subject }
    }

    const customerId = typeof window !== "undefined" ? window.sessionStorage.getItem("pomichCustomerId") : null
    const customerToken = customerId
      ? readStoredAuthSession(authSessionStorageKey("customer", customerId), "customer", customerId)
      : undefined
    if (!customerId || !customerToken) {
      throw Object.assign(new Error("provider_session_missing"), { detail: "provider_session_missing" })
    }

    const linkedId = resolveProviderIdForCustomer(customerId)
    if (linkedId) storeLinkedProviderId(linkedId)

    const session = await createSelfProviderSession(customerId, customerToken)
    return applyProviderSession(session)
  }, [activeProviderId, activeProviderToken, applyProviderSession])

  const refreshProfile = useCallback(async (overrideId?: string, overrideToken?: string) => {
    const targetId = overrideId || activeProviderId
    const targetToken = overrideToken || activeProviderToken
    try {
      const loaded = await getProviderProfile(targetId, targetToken)
      setProfile(loaded)
      setLoadError(undefined)
      return loaded
    } catch {
      const providers = await getProviders()
      const current = Array.isArray(providers) ? providers.find((item) => item.id === targetId) : undefined
      if (current) {
        setProfile(current)
        setLoadError(undefined)
        return current
      }
      throw new Error("provider_profile_missing")
    }
  }, [activeProviderId, activeProviderToken])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        const session = await ensureProviderSession().catch(() => undefined)
        const targetId = session?.providerId || activeProviderId
        const targetToken = session?.token || activeProviderToken
        await refreshProfile(targetId, targetToken)
        if (targetToken) {
          const [nextOffers, nextOrders] = await Promise.all([
            getProviderOffers(targetId, targetToken).catch(() => []),
            getProviderOrders(targetId, targetToken).catch(() => {
              if (!cancelled) setOrdersError("Не вдалося завантажити історію заявок.")
              return []
            }),
          ])
          if (!cancelled) {
            setOffers(Array.isArray(nextOffers) ? nextOffers : [])
            setOrderHistory(Array.isArray(nextOrders) ? nextOrders : [])
            if (Array.isArray(nextOrders)) setOrdersError(undefined)
          }
        }
      } catch {
        if (!cancelled) setLoadError("Не вдалося завантажити профіль партнера.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const interval = window.setInterval(() => {
      void (async () => {
        const session = await ensureProviderSession().catch(() => undefined)
        const targetId = session?.providerId || activeProviderId
        const targetToken = session?.token || activeProviderToken
        refreshProfile(targetId, targetToken).catch(() => undefined)
        if (!targetToken) return
        setOrdersLoading(true)
        getProviderOrders(targetId, targetToken)
          .then((nextOrders) => {
            if (!cancelled) {
              setOrderHistory(Array.isArray(nextOrders) ? nextOrders : [])
              setOrdersError(undefined)
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) setOrdersLoading(false)
          })
      })()
    }, 12000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeProviderId, activeProviderToken, ensureProviderSession, refreshProfile])

  useEffect(() => {
    if (!profile || editing) return
    setForm(profileToForm(profile))
  }, [profile, editing])

  const profileVerified = isProviderPhoneVerified(profile)
  const isOnline = isProviderOnline(profile)
  const name = profile?.name?.trim() || "Партнер POMICH"

  const openEdit = () => {
    if (profile) setForm(profileToForm(profile))
    setSaveError(undefined)
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
      setSaveError(nameValidation.error || "Введіть ім'я")
      return
    }
    if (!phoneValidation.valid) {
      setPhoneError(phoneValidation.error)
      return
    }
    if (!cityValidation.valid) {
      setSaveError(cityValidation.error || "Оберіть місто")
      return
    }
    if (!form.vehicle.trim()) {
      setSaveError("Вкажіть авто")
      return
    }
    if (form.specialties.length === 0) {
      setSaveError("Оберіть хоча б одну послугу")
      return
    }

    setSaving(true)
    setSaveError(undefined)
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
          plate: profile?.plate,
          specialties: form.specialties,
          serviceRadiusKm: form.serviceRadiusKm,
          location: profile?.location,
        },
        session.token,
      )
      setProfile((prev) => ({ ...(prev ?? saved), ...saved, specialties: toServiceKeys(saved.specialties) }))
      if (typeof window !== "undefined") {
        window.localStorage.setItem("pomichPreferredCity", cityValidation.value)
      }
      setEditing(false)
    } catch (err) {
      const message = messageFromFetchError(err, "Не вдалося зберегти профіль. Спробуйте ще раз.")
      if (message.includes("номер") || message.includes("phone_already")) {
        setPhoneError(message)
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
          {loading && !profile ? (
            <div className="pomich-cabinet-empty">Завантажуємо профіль…</div>
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
                    <div className="pomich-cabinet-field">
                      <span className="pomich-form-label">Послуги *</span>
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                        {services.map((service) => {
                          const selected = form.specialties.includes(service.key)
                          return (
                            <button
                              key={service.key}
                              type="button"
                              onClick={() => toggleSpecialty(service.key)}
                              style={{
                                minHeight: 44,
                                borderRadius: 12,
                                border: `1px solid ${selected ? BRAND : "var(--pomich-border)"}`,
                                background: selected ? "var(--pomich-selected-bg)" : "var(--pomich-surface)",
                                color: "var(--pomich-text)",
                                fontWeight: 850,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
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
                    {saveError ? <div className="pomich-form-error">{saveError}</div> : null}
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
                      <PrimaryButton label={saving ? "Зберігаємо…" : "Зберегти"} onClick={handleSave} disabled={saving} />
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

              {!profileVerified && !editing ? (
                <div className="pomich-cabinet-card pomich-cabinet-verification-help">
                  <div className="pomich-cabinet-section-title">Підтвердження телефону</div>
                  <p className="pomich-cabinet-help-text">
                    Підтвердіть номер у Telegram, щоб вийти на лінію та отримувати заявки.
                  </p>
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
                {offers.length === 0 ? (
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
          {dutyError ? <div className="pomich-form-error" style={{ marginBottom: 10 }}>{dutyError}</div> : null}
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
            onClick={toggleDuty}
            disabled={dutySaving || loading}
          />
        </div>
      </div>
    </div>
  )
}
