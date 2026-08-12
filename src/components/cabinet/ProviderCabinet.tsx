import { useCallback, useEffect, useMemo, useState } from "react"

import {
  getProviderOffers,
  getProviderProfile,
  getProviders,
  messageFromFetchError,
  updateProviderPresence,
  updateProviderProfile,
  type CustomerProfile,
  type DispatchOffer,
  type ProviderAvailability,
} from "../../api/client"
import {
  BRAND,
  DEFAULT_SERVICE_RADIUS_KM,
  getServiceEmoji,
  isProviderPhoneVerified,
  services,
  toServiceKeys,
} from "../../lib/constants"
import type { ServiceKey } from "../../lib/pomichDomain"
import { roleLabel, type UserRole } from "../../lib/userAccount"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { authSessionStorageKey, readStoredAuthSession } from "../../lib/auth"
import { getTelegramContext } from "../../telegram"
import { Header } from "../layout/Header"
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

  const refreshProfile = useCallback(async () => {
    try {
      const loaded = await getProviderProfile(providerId, providerToken)
      setProfile(loaded)
      setLoadError(undefined)
      return loaded
    } catch {
      const providers = await getProviders()
      const current = Array.isArray(providers) ? providers.find((item) => item.id === providerId) : undefined
      if (current) {
        setProfile(current)
        setLoadError(undefined)
        return current
      }
      throw new Error("provider_profile_missing")
    }
  }, [providerId, providerToken])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        await refreshProfile()
        if (providerToken) {
          const nextOffers = await getProviderOffers(providerId, providerToken).catch(() => [])
          if (!cancelled) setOffers(Array.isArray(nextOffers) ? nextOffers : [])
        }
      } catch {
        if (!cancelled) setLoadError("Не вдалося завантажити профіль партнера.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const interval = window.setInterval(() => {
      refreshProfile().catch(() => undefined)
    }, 12000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [providerId, providerToken, refreshProfile])

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
    const phoneValidation = validateUkraineMobilePhone(form.phone)
    if (!form.name.trim()) {
      setSaveError("Введіть ім'я")
      return
    }
    if (!phoneValidation.valid) {
      setPhoneError(phoneValidation.error)
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
      const saved = await updateProviderProfile(
        providerId,
        {
          name: form.name.trim(),
          phone: phoneValidation.e164,
          city: form.city.trim(),
          vehicle: form.vehicle.trim(),
          telegram: profile?.telegram,
          plate: profile?.plate,
          specialties: form.specialties,
          serviceRadiusKm: form.serviceRadiusKm,
          location: profile?.location,
        },
        providerToken,
      )
      setProfile((prev) => ({ ...(prev ?? saved), ...saved, specialties: toServiceKeys(saved.specialties) }))
      setEditing(false)
    } catch (err) {
      setSaveError(messageFromFetchError(err, "Не вдалося зберегти профіль. Спробуйте ще раз."))
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
      const updated = await updateProviderPresence(
        providerId,
        {
          status: isOnline ? "offline" : "online",
          location: profile?.location,
          etaMinutes: profile?.etaMinutes,
        },
        providerToken,
      )
      setProfile((prev) => ({ ...(prev ?? updated), ...updated }))
    } catch (err) {
      const detail = (err as { detail?: string }).detail
      setDutyError(
        detail === "provider verification must be approved before going online"
          ? "Підтвердіть телефон у Telegram, щоб вийти на лінію."
          : detail === "provider profile must be registered before going online"
            ? "Спочатку заповніть профіль партнера."
            : messageFromFetchError(err, "Не вдалося оновити статус. Перевірте з'єднання."),
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
                    <label className="pomich-cabinet-field">
                      <span className="pomich-form-label">Місто</span>
                      <input
                        value={form.city}
                        onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
                        placeholder="Ужгород"
                        className="pomich-form-input"
                      />
                    </label>
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
            </>
          )}
        </div>
      </div>

      <div className="pomich-cabinet-footer">
        <div className="pomich-cabinet-footer-inner">
          {dutyError ? <div className="pomich-form-error" style={{ marginBottom: 10 }}>{dutyError}</div> : null}
          <PrimaryButton
            label={dutySaving ? "Оновлюємо статус…" : isOnline ? "Піти з лінії" : "Вийти на лінію"}
            onClick={toggleDuty}
            disabled={dutySaving || loading}
          />
        </div>
      </div>
    </div>
  )
}
