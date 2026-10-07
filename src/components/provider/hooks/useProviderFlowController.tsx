import useProviderOfferFeed from "./useProviderOfferFeed"
import useProviderGeolocation from "./useProviderGeolocation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { acceptProviderOffer, createProviderAccountSession, createProviderSession, createSelfProviderSession, restoreBrowserSession, declineProviderOffer, getCustomerProfile, getOrder, getProviderOffers, getProviderOrders, getProviderProfile, messageFromFetchError, retryDispatch, setUserPreferredRole, submitOrderReview, updateProviderOrderStatus, updateProviderPresence, updateProviderProfile, ApiRequestError, type AuthSession, type CustomerProfile, type DispatchOffer, type MapRequestPin, type OrderResponse, type ProviderAvailability } from "../../../api/client"
import { DEFAULT_SERVICE_RADIUS_KM, PROVIDER_START, getActiveProviderId, toServiceKeys, composePartnerVehicle, emptyPartnerRegistrationForm, hydratePartnerVehicleFromProfile, isProviderPhoneVerified, partnerVehicleSelectionIsComplete, resolvePartnerVehicleMake, type PartnerRegistrationForm, type OrderStatus } from "../../../lib/constants"
import { readBootstrapProfile, resolveProviderIdForCustomer, storeLinkedProviderId } from "../../../lib/userAccount"
import { readCachedProviderProfile, writeCachedProviderProfile } from "../../../lib/providerProfileCache"
import { clearActiveOrder, persistActiveOrder, pickLatestActiveOrder, readActiveOrder } from "../../../lib/customerSession"
import { clearPendingPartnerReview, persistPendingPartnerReview, readPendingPartnerReview } from "../../../lib/appRole"
import { requestCurrentPosition } from "../../../lib/mapGeo"
import { validateUkraineMobilePhone } from "../../../lib/ukrainePhone"
import { validateUkrainePlate } from "../../../lib/ukrainePlate"
import { isPartnerProfileComplete } from "../../../lib/partnerProfileComplete"
import { validatePersonName } from "../../../lib/personName"
import { DEFAULT_SERVICE_CITY, validateServiceCity } from "../../../lib/ukraineCities"
import { writeCityUserPicked, writePreferredCity } from "../../../lib/preferredCity"
import { authSessionStorageKey, isAuthSessionToken, readAuthSessionSubject, readPersistedCustomerId, readStoredAuthSession, readStoredCustomerAuthSession, storeAuthSession } from "../../../lib/auth"
import { isCustomerVerified } from "../../../lib/customerProfile"
import { presenceErrorMessage } from "../../ui/DutyStatusToggle"
import { isPresentableOffer, offerActionErrorMessage, offerSecondsLeft, parseOfferPrice, pinFromOffer, readPersistedOfferDismissals, writePersistedOfferDismissals } from "../../../lib/dispatchOffer"

import { getTelegramContext } from "../../../telegram"
import { useScreenWakeLock } from "../../../hooks/useScreenWakeLock"
import { ensurePartnerAlertPermission } from "../../../lib/partnerDutyAlerts"
import { normalizeOrderStatus } from "../../../lib/orderStatus"
import type { ServiceKey } from "../../../lib/pomichDomain"
import type { MapTileTheme } from "../../../lib/theme"
import { useConfirmDialog } from "../../ui/ConfirmDialog"

function resolveSessionProviderId(session: { providerId?: string; subjectId?: string }, fallback: string) {
  return String(session.providerId || session.subjectId || fallback).trim() || fallback
}

export default function useProviderFlowController({
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

  const confirm = useConfirmDialog()
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
  const [loginView, setLoginView] = useState<"login" | "register">("register")
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
  const [dutySheetSnap, setDutySheetSnap] = useState<"collapsed" | "half" | "expanded">(() =>
    initialScreen === "offers" ? "expanded" : "collapsed",
  )
  const [onDuty, setOnDuty] = useState(false)
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [presenceToast, setPresenceToast] = useState<string | undefined>()
  const [registrationSaving, setRegistrationSaving] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | undefined>()
  const [selectedRequestPin, setSelectedRequestPin] = useState<MapRequestPin | undefined>()
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
  const { providerLocation, setProviderLocation, providerGeoLoading, providerGeoError, setProviderGeoError, providerRecenterTrigger, providerSpeedMps, setProviderGeoWatchEpoch, providerLocationRef, retryProviderGeolocation } = useProviderGeolocation(onDuty || ["duty", "navigation", "arrived", "awaiting_price", "offer"].includes(step))
  const [partnerReviewSaving, setPartnerReviewSaving] = useState(false)
  const [partnerReviewError, setPartnerReviewError] = useState<string | undefined>()
  const [partnerReviewSubmitted, setPartnerReviewSubmitted] = useState(false)
  const [providerProfile, setProviderProfile] = useState<ProviderAvailability>({
    id: providerId,
    name: "",
    vehicle: "",
    plate: "",
    phone: "",
    telegram: "",
    status: "offline",
    location: PROVIDER_START,
    specialties: [],
    serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
  })
  const [registrationForm, setRegistrationForm] = useState<PartnerRegistrationForm>(() => emptyPartnerRegistrationForm())
  const dismissedOfferIdRef = useRef<string | undefined>(undefined)
  const autoOpenedOfferIdRef = useRef<string | undefined>(undefined)
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
    name: providerProfile.name || "Партнер POMICH",
    rating: providerProfile.rating,
    vehicle: providerProfile.vehicle || "",
    plate: providerProfile.plate || "",
    phone: providerProfile.phone || "",
    telegram: providerProfile.telegram || "",
    status: onDuty ? "online" : "offline",
    etaMinutes: providerProfile.etaMinutes,
    location: providerLocation,
    specialties: providerSpecialties.length > 0 ? providerSpecialties : registrationForm.specialties,
    serviceRadiusKm: providerProfile.serviceRadiusKm ?? registrationForm.serviceRadiusKm,
    verificationStatus: providerProfile.verificationStatus,
    verification: providerProfile.verification,
    trustedBadges: providerProfile.trustedBadges,
    providerKind: "dispatch",
  }
  const telegramContext = useMemo(() => getTelegramContext(), [])
  const { incomingOffers, setIncomingOffers, setNearbyRequestPins, mapRequestPins, setMapRequestPins, offerClock, seenDutyAlertIdsRef, dutyAlertsSeededRef } = useProviderOfferFeed({
    activeOrder, onDuty, providerAuthToken, providerId, step,
    radiusKm: providerProfile.serviceRadiusKm ?? registrationForm.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM,
    providerSpecialties, providerLocationRef, dismissedOfferIdsRef, dismissedOrderIdsRef,
    setOfferError, webApp: telegramContext.webApp,
  })
  useScreenWakeLock(onDuty)
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
        const cityIsPlaceholder = !currentCity
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
    if (!providerAuthToken) return undefined
    try {
      const profile = await getProviderProfile(providerId, providerAuthToken)
      if (profile?.id) return profile
    } catch {
      return undefined
    }
    return undefined
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
      const restored = await restoreBrowserSession("provider")
      if (restored) return restored
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
        ...(typeof providerProfile.etaMinutes === "number" ? { etaMinutes: providerProfile.etaMinutes } : {}),
      }, providerAuthToken).catch(() => undefined)
    }

    heartbeat()
    const interval = window.setInterval(heartbeat, 12000)
    return () => window.clearInterval(interval)
  }, [onDuty, providerAuthToken, providerId, providerProfile.etaMinutes, providerProfile.assignedOrderId, activeOrder?.id])

  useEffect(() => {
    if (!selectedRequestPin) return
    const stillOpen = mapRequestPins.some(
      (pin) => pin.id === selectedRequestPin.id || (pin.offerId && pin.offerId === selectedRequestPin.offerId),
    )
    if (stillOpen) return
    setSelectedRequestPin(undefined)
    setProposedPrice("")
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
    setOfferError(undefined)
    // Stay on duty map — OrderRequestSheet overlays (avoid stacking IncomingOfferStep).
  }

  // Auto-open the accept/decline sheet once per new offer so partners do not miss CTAs.
  useEffect(() => {
    if (step !== "duty" || !onDuty) return
    if (!activeOffer) return
    if (autoOpenedOfferIdRef.current === activeOffer.id) return
    autoOpenedOfferIdRef.current = activeOffer.id
    openOfferDetail(activeOffer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when offer id arrives
  }, [step, onDuty, activeOffer?.id])

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
    if (offerError === "Вкажіть вартість послуги в гривнях.") setOfferError(undefined)
  }

  const acceptOffer = async (offer: DispatchOffer, priceOverride?: string) => {
    if (offerSaving) return
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
      serviceDetails: offer.serviceDetails,
    } as OrderResponse
    persistActiveOrder(offer.orderId, "accepted")
    rememberDismissedOffer(offer.id, offer.orderId)
    setActiveOrder(optimisticOrder)
    setIncomingOffers([])
    setSelectedRequestPin(undefined)
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
    if (offerSaving) return
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
    setOfferError(undefined)
  }

  const declineFromSheet = async () => {
    if (!selectedRequestPin || offerSaving) return
    const offer = incomingOffers.find((item) => item.id === selectedRequestPin.offerId || item.orderId === selectedRequestPin.id)
    if (offer) {
      await declineOffer(offer)
      return
    }
    rememberDismissedOffer(undefined, selectedRequestPin.id)
    setNearbyRequestPins((pins) => pins.filter((item) => item.id !== selectedRequestPin.id))
    setSelectedRequestPin(undefined)
    setProposedPrice("")
    setOfferError(undefined)
  }

  const acceptFromMapPin = (pin: MapRequestPin) => {
    openRequestPin(pin)
  }

  const acceptFromSheet = async (priceOverride?: string) => {
    if (!selectedRequestPin || offerSaving) return
    const priceSource = priceOverride ?? proposedPrice
    if (priceSource.trim()) {
      setProposedPrice(priceSource)
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
    const confirmed = await confirm({
      title: "Скасувати заявку?",
      description: "Клієнт одразу побачить скасування та отримає сповіщення.",
      confirmLabel: "Скасувати заявку",
      cancelLabel: "Продовжити роботу",
      danger: true,
    })
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
    if (registrationSaving) return
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
      }
      writePreferredCity(cityValidation.value)
      writeCityUserPicked(true)
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
    // Kick browser/Telegram GPS in the same tap turn before any await — Safari/Chrome
    // suppress the prompt once the user-gesture stack is gone.
    const freshGeoPromise =
      nextDuty
        ? new Promise<{ lat: number; lng: number } | null>((resolve) => {
            let done = false
            const finish = (point: { lat: number; lng: number } | null) => {
              if (done) return
              done = true
              resolve(point)
            }
            window.setTimeout(() => finish(null), 18_000)
            void ensurePartnerAlertPermission()
            requestCurrentPosition(
              (point) => finish(point),
              (message, kind) => {
                setProviderGeoError(message)
                if (kind === "permission-denied") {
                  setPresenceToast(message)
                }
                finish(null)
              },
              { mode: "explicit" },
            )
          })
        : Promise.resolve(null)
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
        const freshPoint = await freshGeoPromise
        if (freshPoint) {
          setProviderLocation(freshPoint)
          providerLocationRef.current = freshPoint
          setProviderGeoError(undefined)
          setProviderGeoWatchEpoch((value) => value + 1)
        } else if (!providerLocationRef.current) {
          const message =
            "Не вдалося визначити геолокацію. Дозвольте доступ і натисніть «Оновити», потім знову «На лінії»."
          setOfferError(message)
          setPresenceToast(message)
          setProviderGeoError(message)
          return
        }
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
        location: providerLocationRef.current,
        ...(((fresh || providerProfile).etaMinutes != null)
          ? { etaMinutes: (fresh || providerProfile).etaMinutes }
          : {}),
      }, session.token)
      setOnDuty(nextDuty)
      setDutySheetSnap(nextDuty ? "half" : "collapsed")
      setProviderProfile((profile) => ({ ...profile, ...updated, status: updated.status ?? (nextDuty ? "online" : "offline") }))
      if (nextDuty) setDutySheetSnap("half")
      else setDutySheetSnap("collapsed")
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
  return { providerToken, providerRegistered, onLogout, onRestoreAccount, mapTileTheme, providerId, linkedPartnerId, effectiveProviderRegistered, providerAuthToken, authError, setAuthError, accountLogin, setAccountLogin, accountPassword, setAccountPassword, authSaving, loginView, setLoginView, step, setStep, dutySheetSnap, onDuty, presenceSaving, presenceToast, registrationSaving, registrationError, incomingOffers, setIncomingOffers, setNearbyRequestPins, mapRequestPins, selectedRequestPin, setSelectedRequestPin, activeOrder, offerError, setOfferError, offerSaving, orderAdvancing, proposedPrice, priceNote, setPriceNote, offerClock, providerLocation, partnerReviewSaving, partnerReviewError, partnerReviewSubmitted, providerGeoLoading, providerGeoError, providerRecenterTrigger, providerSpeedMps, providerProfile, setProviderProfile, registrationForm, setRegistrationForm, dismissedOfferIdsRef, dismissedOrderIdsRef, providerPresence, telegramContext, otpBotUsername, customerIdForOtp, customerTokenForOtp, customerOtpProfile, setCustomerOtpProfile, isPartnerRegisteredAndCompleted, providerCanGoOnline, profileGateOpenRef, markProviderPhoneVerified, loadCurrentProvider, retryProviderGeolocation, activeOffer, secondsLeft, openOfferDetail, handleOfferAcceptBlocked, syncProposedPrice, acceptOffer, declineOffer, openRequestPin, declineFromSheet, acceptFromMapPin, acceptFromSheet, contactFromMapPin, advanceProviderOrder, cancelActiveOrder, updateRegistrationForm, toggleRegistrationSpecialty, saveRegistration, setDuty, handleDutyToggle, openPhoneOrProfileGate, completingPartnerProfile, submitProviderAccountLogin, returnToDuty, submitPartnerOrderReview, openPartnerRestoreOrLogin }
}

export type ProviderFlowState = ReturnType<typeof useProviderFlowController>
