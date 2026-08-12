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
  composePartnerVehicle,
  emptyPartnerRegistrationForm,
  getActiveProviderId,
  getProviderCapabilityLabel,
  getServiceEmoji,
  hydratePartnerVehicleFromProfile,
  isProviderPhoneVerified,
  partnerVehicleSelectionIsComplete,
  provider,
  resolvePartnerVehicleMake,
  services,
  toServiceKeys,
  type OrderStatus,
  type PartnerRegistrationForm,
  type Point,
} from "../../lib/constants"
import { PartnerVehicleFields } from "./PartnerVehicleFields"
import {
  acceptProviderOffer,
  createProviderAccountSession,
  createProviderSession,
  declineProviderOffer,
  getOrder,
  getProviderOffers,
  getProviders,
  updateProviderOrderStatus,
  updateProviderPresence,
  updateProviderProfile,
  type DispatchOffer,
  type OrderResponse,
  type ProviderAvailability,
} from "../../api/client"
import { PrimaryButton } from "../ui/PrimaryButton"
import { DutyStatusToggle, PresenceToast, presenceErrorMessage } from "../ui/DutyStatusToggle"
import { SecondaryButton } from "../ui/SecondaryButton"
import { Timeline } from "../ui/Timeline"
import { ProviderCard } from "../ui/ProviderCard"
import { OtpVerificationPanel } from "../ui/OtpVerificationPanel"
import type { CustomerProfile } from "../../api/client"
import { getTelegramContext } from "../../telegram"
import ScreenLayout from "../layout/ScreenLayout"
import FormContainer, { FormHeader } from "../layout/FormContainer"
import Header from "../layout/Header"
import { ServiceRadiusField } from "../ui/ServiceRadiusField"
import RouteMap from "../map/RouteMap"
import { authSessionStorageKey, isAuthSessionToken, readStoredAuthSession, storeAuthSession } from "../../lib/auth"
import { filterActiveOffers, isOfferActive, offerSecondsLeft } from "../../lib/dispatchOffer"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { isValidUkrainePlate, validateUkrainePlate } from "../../lib/ukrainePlate"
import { PhoneInput } from "../ui/PhoneInput"
import { UkrainePlateInput } from "../ui/UkrainePlateInput"
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
  const composedVehicle = composePartnerVehicle(form.vehicleMake, form.vehicleModel, form.vehicleMakeOther)
  const canSubmit = Boolean(
    form.name.trim()
    && validateUkraineMobilePhone(form.phone).valid
    && partnerVehicleSelectionIsComplete(form.vehicleMake, form.vehicleMakeOther, form.vehicleModel)
    && composedVehicle.trim()
    && isValidUkrainePlate(form.plate)
    && form.specialties.length > 0,
  )

  return (
    <ScreenLayout footer={<PrimaryButton label={saving ? "Зберігаємо профіль…" : "Зареєструватись"} onClick={onSubmit} disabled={!canSubmit || saving} />}>
      <Header title="Реєстрація партнера" subtitle="Вкажіть, яку допомогу ви реально можете виконувати" />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Ім'я партнера</span>
            <input value={form.name} onChange={(event) => onChange({ name: event.target.value })} placeholder="Ваше ім'я" style={{ height: 44, borderRadius: 12, border: `1px solid ${BORDER}`, padding: "0 12px", font: "inherit", fontWeight: 750, color: DARK }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Телефон</span>
            <PhoneInput value={form.phone} onChange={(phone) => onChange({ phone })} />
          </label>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14, display: "grid", gap: 10 }}>
          <PartnerVehicleFields form={form} onChange={onChange} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 850 }}>Номер</span>
              <UkrainePlateInput
                value={form.plate}
                onChange={(plate) => onChange({ plate })}
              />
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
                <button key={service.key} type="button" onClick={() => onToggleSpecialty(service.key)} className="pomich-service-card" style={{ border: selected ? `1.5px solid ${BRAND}` : `1px solid ${BORDER}`, background: selected ? "#E8F8F1" : service.tone, color: DARK, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: "clamp(1rem, 0.92rem + 0.35vw, 1.25rem)" }}>{service.emoji}</span>
                    <span style={{ fontWeight: 900, fontSize: "var(--pomich-text-sm)", lineHeight: 1.2 }}>{getProviderCapabilityLabel(service.key)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {error ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800 }}>{error}</div> : null}
      </div>
    </ScreenLayout>
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
  const parsedPrice = Number(proposedPrice.replace(",", "."))
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0
  const customerPickup = offer.customerCoordinates ?? PICKUP
  const eta = offer.etaMinutes ?? Math.ceil((offer.distanceKm ?? 1) * 4)
  const distanceLabel = typeof offer.distanceKm === "number" ? `${offer.distanceKm.toFixed(1)} км до клієнта` : "Відстань уточнюється"
  const handleAcceptClick = () => {
    if (saving) return
    if (secondsLeft <= 0) {
      onAcceptBlocked?.("expired")
      return
    }
    if (!priceValid) {
      onAcceptBlocked?.("price")
      return
    }
    onAccept()
  }

  return (
    <ScreenLayout footer={<div style={{ display: "grid", gap: 10 }}><PrimaryButton label={saving ? "Приймаємо…" : secondsLeft <= 0 ? "Час вийшов" : "ПРИЙНЯТИ З ЦІНОЮ"} onClick={handleAcceptClick} disabled={saving} /><SecondaryButton label="ПРОПУСТИТИ" onClick={onDecline} /></div>}>
      <Header title="Нове замовлення" subtitle={secondsLeft > 0 ? `${secondsLeft} сек` : "Час вийшов"} status="searching" />
      <div style={{ padding: "8px 16px 16px", display: "grid", gap: 12 }}>
        <RouteMap
          pickup={customerPickup}
          providers={[{ id: offer.providerId, name: "Ви", status: "online", location: providerLocation, etaMinutes: eta }]}
          subtitle={`${distanceLabel} · ~${eta} хв`}
        />
        <div style={{ background: "var(--pomich-accent-panel-bg)", color: "#fff", borderRadius: 18, padding: 16, textAlign: "center" }}>
          <div style={{ color: "#A7F3D0", fontWeight: 800, fontSize: 12 }}>До клієнта</div>
          <div style={{ fontSize: 32, fontWeight: 950, marginTop: 6 }}>{typeof offer.distanceKm === "number" ? `${offer.distanceKm.toFixed(1)} км` : "—"}</div>
          <div style={{ color: "#D1FAE5", fontWeight: 800, marginTop: 4 }}>~{eta} хв до місця подачі</div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 950, fontSize: 20, color: DARK }}>{getServiceEmoji(offer.service)} {getProviderCapabilityLabel(offer.service)}</div>
              <div style={{ color: "#6B7280", fontWeight: 750, marginTop: 5 }}>{distanceLabel}</div>
            </div>
            <div style={{ background: "#E8F8F1", color: BRAND, borderRadius: 999, padding: "8px 10px", fontWeight: 950 }}>~{eta} хв</div>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 8, color: DARK, fontSize: 13 }}>
            <div><strong>Авто:</strong> {offer.vehicleState ?? "Не вказано"}</div>
            <div><strong>Район:</strong> {offer.approximateLocation ?? "Поруч із вами"}</div>
            {offer.customerComment ? (
              <div style={{ background: "#EFF6FF", color: "#1D4ED8", borderRadius: 12, padding: "10px 12px", lineHeight: 1.4 }}>
                <strong>Коментар клієнта:</strong> {offer.customerComment}
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 16, display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 950, color: DARK }}>Запропонуйте ціну клієнту</div>
          <input value={proposedPrice} onChange={(event) => onProposedPriceChange(event.target.value)} inputMode="decimal" placeholder="Вартість, ₴" style={{ width: "100%", minHeight: 50, padding: "0 14px", borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 16, fontWeight: 800, fontFamily: "inherit" }} />
          <input value={priceNote} onChange={(event) => onPriceNoteChange(event.target.value)} placeholder="Примітка (необов'язково)" style={{ width: "100%", minHeight: 46, padding: "0 14px", borderRadius: 16, border: `1px solid ${BORDER}`, fontSize: 14, fontWeight: 700, fontFamily: "inherit" }} />
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
  if (status === "searching" || status === "accepted" || status === "price_confirmed" || status === "assigned" || status === "en_route" || status === "arrived" || status === "in_progress" || status === "completed" || status === "cancelled" || status === "draft") {
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
  const [step, setStep] = useState<"register" | "verify" | "duty" | "offer" | "navigation" | "arrived" | "completed">(() => {
    if (typeof window === "undefined") return "register"
    return window.localStorage.getItem(`pomichPartnerRegistered:${getActiveProviderId()}`) ? "duty" : "register"
  })
  const [onDuty, setOnDuty] = useState(false)
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [presenceToast, setPresenceToast] = useState<string | undefined>()
  const [registrationSaving, setRegistrationSaving] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | undefined>()
  const [incomingOffers, setIncomingOffers] = useState<DispatchOffer[]>([])
  const [activeOrder, setActiveOrder] = useState<OrderResponse | undefined>()
  const [offerError, setOfferError] = useState<string | undefined>()
  const [offerSaving, setOfferSaving] = useState(false)
  const [proposedPrice, setProposedPrice] = useState("")
  const [priceNote, setPriceNote] = useState("")
  const [offerClock, setOfferClock] = useState(Date.now())
  const [progress, setProgress] = useState(18)
  const [providerLocation, setProviderLocation] = useState<Point>(PROVIDER_START)
  const [providerProfile, setProviderProfile] = useState<ProviderAvailability>({
    id: providerId,
    name: "",
    rating: provider.rating,
    vehicle: "",
    plate: "",
    phone: "",
    telegram: provider.telegram,
    status: "offline",
    etaMinutes: provider.etaMinutes,
    location: PROVIDER_START,
    specialties: [],
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
  })
  const [registrationForm, setRegistrationForm] = useState<PartnerRegistrationForm>(() => emptyPartnerRegistrationForm())
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
  const customerIdForOtp = typeof window !== "undefined" ? window.sessionStorage.getItem("pomichCustomerId") : null
  const customerTokenForOtp = customerIdForOtp
    ? readStoredAuthSession(authSessionStorageKey("customer", customerIdForOtp), "customer", customerIdForOtp)
    : undefined

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
            setOfferError("Заявку скасовано клієнтом.")
            return
          }
          setActiveOrder(order)
        })
        .catch(() => undefined)
    }

    refreshActiveOrder()
    const interval = window.setInterval(refreshActiveOrder, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeOrder?.id])

  const activeOffer = incomingOffers.find((offer) => isOfferActive(offer, offerClock))
  const secondsLeft = offerSecondsLeft(activeOffer, offerClock)

  useEffect(() => {
    if (step !== "offer" || !activeOffer || secondsLeft > 0) return
    setOfferError("Пропозиція вже завершилась. Очікуйте нову заявку.")
    setIncomingOffers((offers) => offers.filter((item) => item.id !== activeOffer.id))
    setStep("duty")
  }, [activeOffer, secondsLeft, step])

  const handleOfferAcceptBlocked = (reason: "expired" | "price") => {
    if (reason === "expired") {
      setOfferError("Пропозиція вже завершилась. Очікуйте нову заявку.")
      if (activeOffer) {
        setIncomingOffers((offers) => offers.filter((item) => item.id !== activeOffer.id))
      }
      setStep("duty")
      return
    }
    setOfferError("Вкажіть вартість послуги в гривнях.")
  }

  const acceptOffer = async (offer: DispatchOffer) => {
    const parsedPrice = Number(proposedPrice.replace(",", "."))
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
      setOnDuty(true)
      setProposedPrice("")
      setPriceNote("")
      setStep("navigation")
      setProgress(18)
    } catch (error) {
      const detail = (error as { detail?: { code?: string; message?: string } }).detail
      setOfferError(detail?.code === "OFFER_EXPIRED" ? "Пропозиція вже завершилась." : detail?.code === "PRICE_REQUIRED" ? "Вкажіть вартість послуги." : "Замовлення вже прийняв інший виконавець.")
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
    const plateValidation = validateUkrainePlate(registrationForm.plate)
    const vehicleMake = resolvePartnerVehicleMake(registrationForm.vehicleMake, registrationForm.vehicleMakeOther)
    const vehicle = composePartnerVehicle(registrationForm.vehicleMake, registrationForm.vehicleModel, registrationForm.vehicleMakeOther)
    if (!registrationForm.name.trim() || !phoneValidation.valid || !plateValidation.valid || !partnerVehicleSelectionIsComplete(registrationForm.vehicleMake, registrationForm.vehicleMakeOther, registrationForm.vehicleModel) || !vehicle.trim() || registrationForm.specialties.length === 0) {
      setRegistrationError(
        !phoneValidation.valid
          ? (phoneValidation.error || "Введіть коректний номер телефону")
          : !plateValidation.valid
            ? (plateValidation.error || "Введіть коректний номер авто")
            : "Заповніть профіль і оберіть хоча б одну послугу.",
      )
      return
    }

    setRegistrationSaving(true)
    setRegistrationError(undefined)
    try {
      if (!providerAuthToken) throw new Error("provider_session_missing")
      const updated = await updateProviderProfile(providerId, {
        name: registrationForm.name,
        phone: phoneValidation.e164,
        telegram: registrationForm.telegram,
        vehicle,
        vehicleMake,
        vehicleModel: registrationForm.vehicleModel,
        plate: plateValidation.plate,
        city: registrationForm.city,
        specialties: registrationForm.specialties,
        serviceRadiusKm: registrationForm.serviceRadiusKm,
        location: providerLocation,
      }, providerAuthToken)
      setProviderProfile((profile) => ({ ...profile, ...updated, specialties: toServiceKeys(updated.specialties) }))
      if (typeof window !== "undefined") window.localStorage.setItem(`pomichPartnerRegistered:${providerId}`, "1")
      setStep(isProviderPhoneVerified(updated) ? "duty" : "verify")
    } catch {
      setRegistrationError("Не вдалося зберегти профіль партнера.")
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
      if (!providerAuthToken) throw Object.assign(new Error("provider_session_missing"), { detail: "provider_session_missing" })
      const updated = await updateProviderPresence(providerId, {
        status: nextDuty ? "online" : "offline",
        location: providerLocation,
        etaMinutes: providerProfile.etaMinutes ?? provider.etaMinutes,
      }, providerAuthToken)
      setOnDuty(nextDuty)
      setProviderProfile((profile) => ({ ...profile, ...updated, status: updated.status ?? (nextDuty ? "online" : "offline") }))
    } catch (error) {
      setOnDuty(false)
      const detail = (error as { detail?: string }).detail
      const message = presenceErrorMessage(typeof detail === "string" ? detail : undefined)
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

  if (step === "verify") {
    const otpProfile: CustomerProfile = {
      id: customerIdForOtp || providerId,
      name: providerProfile.name || registrationForm.name,
      phone: providerProfile.phone || registrationForm.phone,
      verificationStatus: providerProfile.verificationStatus,
    }
    return (
      <ScreenLayout>
        <Header title="Підтвердження телефону" subtitle="Код надійде у Telegram — як для клієнта" />
        <div style={{ padding: "8px 16px 16px" }}>
          <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 18, padding: 14 }}>
            <OtpVerificationPanel
              profile={otpProfile}
              customerToken={customerTokenForOtp}
              isTelegram={telegramContext.isTelegram}
              autoSendChannel={telegramContext.isTelegram ? "telegram" : undefined}
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
        </div>
      </ScreenLayout>
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
          providerLocation={providerLocation}
          secondsLeft={secondsLeft}
          saving={offerSaving}
          error={offerError}
          proposedPrice={proposedPrice}
          priceNote={priceNote}
          onProposedPriceChange={setProposedPrice}
          onPriceNoteChange={setPriceNote}
          onAccept={() => acceptOffer(activeOffer)}
          onDecline={() => declineOffer(activeOffer)}
          onAcceptBlocked={handleOfferAcceptBlocked}
        />
      )
    }

    return (
      <ScreenLayout footer={onDuty ? <div style={{ display: "grid", gap: 10 }}><PrimaryButton label="Дивитися заявки поруч" onClick={() => setStep("offer")} disabled={!providerAuthToken} /><SecondaryButton label="Піти з лінії" onClick={() => setDuty(false)} disabled={presenceSaving} /><SecondaryButton label="Редагувати профіль" onClick={() => setStep("register")} /></div> : <div style={{ display: "grid", gap: 10 }}><PrimaryButton label={!providerCanGoOnline ? "Підтвердити телефон" : presenceSaving ? "Оновлюємо статус…" : "Вийти на лінію"} onClick={() => (providerCanGoOnline ? setDuty(true) : setStep("verify"))} disabled={presenceSaving} /><SecondaryButton label="Редагувати профіль" onClick={() => setStep("register")} /></div>}>
        <Header title="Партнер POMICH" subtitle={onDuty ? "Ви на лінії та бачите заявки поруч" : "Почніть зміну, щоб клієнти бачили вас на карті"} />
        <div className="pomich-flow-panel">
          {authError ? <div style={{ background: "#FFF1F2", color: "#BE123C", borderRadius: 14, padding: 12, fontWeight: 800, fontSize: "var(--pomich-text-sm)" }}>{authError}</div> : null}
          <RouteMap pickup={providerLocation} providers={onDuty ? [providerPresence] : []} subtitle={onDuty ? "Ваша позиція активна" : "Ваша позиція прихована для клієнтів"} />
          <div className="pomich-duty-panel">
            <div className="pomich-duty-panel__head">
              <div>
                <div className="pomich-duty-panel__label">Статус зміни</div>
                <div className="pomich-duty-panel__status">{onDuty ? "На лінії" : "Поза лінією"}</div>
              </div>
              <DutyStatusToggle onDuty={onDuty} saving={presenceSaving} disabled={!providerAuthToken} onToggle={handleDutyToggle} />
            </div>
            <div className="pomich-duty-stat-grid">
              <div className="pomich-duty-stat">
                <div className="pomich-duty-stat__label">Зона</div>
                <div className="pomich-duty-stat__value">Ужгород · 7 км</div>
              </div>
              <div className="pomich-duty-stat">
                <div className="pomich-duty-stat__label">ETA клієнту</div>
                <div className="pomich-duty-stat__value">~{provider.etaMinutes} хв</div>
              </div>
            </div>
            <div className="pomich-duty-panel__note">
              {onDuty ? "Клієнти бачать вашу картку, рейтинг, приблизний час прибуття та можуть отримати вас після створення заявки." : "Поки ви поза лінією, клієнт бачить менше доступних механіків поруч."}
            </div>
          </div>
          <div className="pomich-inline-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 950, color: DARK, fontSize: "var(--pomich-text-base)" }}>Профіль допомоги</div>
                <div style={{ color: "#6B7280", fontSize: "var(--pomich-text-xs)", fontWeight: 800, marginTop: 3 }}>{providerPresence.vehicle || "Авто не вказано"} · радіус {providerPresence.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM} км</div>
              </div>
              <button type="button" onClick={() => setStep("register")} style={{ border: `1px solid ${BORDER}`, background: BG, color: DARK, borderRadius: 999, padding: "6px 9px", fontSize: "var(--pomich-text-xs)", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>Змінити</button>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(providerPresence.specialties ?? []).map((specialty) => (
                <span key={specialty} style={{ borderRadius: 999, padding: "5px 9px", background: "#E8F8F1", color: BRAND, fontSize: "var(--pomich-text-xs)", fontWeight: 900 }}>{getProviderCapabilityLabel(specialty)}</span>
              ))}
            </div>
          </div>
          {offerError ? <div style={{ background: "#FFF7ED", color: "#B45309", borderRadius: 14, padding: 10, fontWeight: 850, fontSize: "var(--pomich-text-sm)" }}>{offerError}</div> : null}
        </div>
        {presenceToast ? <PresenceToast message={presenceToast} /> : null}
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
