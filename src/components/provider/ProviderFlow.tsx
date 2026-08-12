import { useEffect, useMemo, useState } from "react"

import {
  BG,
  BORDER,
  BRAND,
  DARK,
  DEFAULT_DESTINATION,
  DEFAULT_SERVICE_RADIUS_KM,
  PICKUP,
  PROVIDER_START,
  getActiveProviderId,
  getProviderCapabilityLabel,
  getServiceEmoji,
  isVerified,
  provider,
  services,
  toServiceKeys,
  type OrderStatus,
  type PartnerRegistrationForm,
  type Point,
} from "../../lib/constants"
import {
  acceptProviderOffer,
  createProviderAccountSession,
  createProviderSession,
  declineProviderOffer,
  getProviderOffers,
  getProviders,
  submitProviderVerification,
  updateProviderOrderStatus,
  updateProviderPresence,
  updateProviderProfile,
  type DispatchOffer,
  type OrderResponse,
  type ProviderAvailability,
} from "../../api/client"
import { PrimaryButton } from "../ui/PrimaryButton"
import { SecondaryButton } from "../ui/SecondaryButton"
import { VerificationPill } from "../ui/VerificationPill"
import { Timeline } from "../ui/Timeline"
import { ProviderCard } from "../ui/ProviderCard"
import ScreenLayout from "../layout/ScreenLayout"
import FormContainer, { FormHeader } from "../layout/FormContainer"
import Header from "../layout/Header"
import { ServiceRadiusField } from "../ui/ServiceRadiusField"
import RouteMap from "../map/RouteMap"
import { authSessionStorageKey, isAuthSessionToken, parseApiDateMs, readStoredAuthSession, storeAuthSession } from "../../lib/auth"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { PhoneInput } from "../ui/PhoneInput"
import type { ServiceKey } from "../../lib/pomichDomain"

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
      <FormContainer>
        <div className="pomich-form-card">
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Логін</span>
            <input value={login} onChange={(event) => onLoginChange(event.target.value)} autoComplete="username" className="pomich-form-input" style={{ color: DARK }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Пароль</span>
            <input value={password} onChange={(event) => onPasswordChange(event.target.value)} type="password" autoComplete="current-password" className="pomich-form-input" style={{ color: DARK }} />
          </label>
        </div>
        {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{error}</div> : null}
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
}: {
  form: PartnerRegistrationForm
  saving: boolean
  error?: string
  onChange: (patch: Partial<PartnerRegistrationForm>) => void
  onToggleSpecialty: (specialty: ServiceKey) => void
  onSubmit: () => void
}) {
  const canSubmit = Boolean(
    form.name.trim()
    && validateUkraineMobilePhone(form.phone).valid
    && form.vehicle.trim()
    && form.specialties.length > 0,
  )
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
            <PhoneInput value={form.phone} onChange={(phone) => onChange({ phone })} />
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

function interpolate(from: Point, to: Point, progress: number): Point {
  const ratio = Math.max(0, Math.min(100, progress)) / 100
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
  }
}

function normalizeOrderStatus(status?: string): OrderStatus {
  if (status === "searching" || status === "assigned" || status === "en_route" || status === "arrived" || status === "in_progress" || status === "completed" || status === "cancelled" || status === "draft") {
    return status
  }
  if (status === "created" || status === "matching") return "searching"
  if (status === "tracking") return "en_route"
  return "draft"
}

export default function ProviderFlow({ providerToken }: { providerToken?: string }) {
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
      setAuthError("Партнерська сесія не відкрита. Увійдіть з логіном і паролем або зверніться до диспетчера.")
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
        if (!cancelled) setAuthError("Не вдалося відкрити захищену сесію партнера.")
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
    const phoneValidation = validateUkraineMobilePhone(registrationForm.phone)
    if (!registrationForm.name.trim() || !phoneValidation.valid || !registrationForm.vehicle.trim() || registrationForm.specialties.length === 0) {
      setRegistrationError(phoneValidation.valid ? "Заповніть профіль і оберіть хоча б одну послугу." : (phoneValidation.error || "Введіть коректний номер телефону"))
      return
    }

    setRegistrationSaving(true)
    setRegistrationError(undefined)
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      const updated = await updateProviderProfile(providerId, {
        ...registrationForm,
        phone: phoneValidation.e164,
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
