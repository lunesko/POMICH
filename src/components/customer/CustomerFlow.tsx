import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import "./CustomerFlowUx.css"

import {
  cancelOrder as cancelOrderRequest,
  confirmOrderPrice,
  createGuestCustomerSession,
  createOrder,
  getCustomerOrders,
  getMapProviders,
  getOrder,
  getTelegramSession,
  messageFromFetchError,
  retryDispatch,
  submitOrderReview,
  updateCustomerProfile,
  type AuthSession,
  type CustomerProfile,
  type OrderResponse,
  type ProviderAvailability,
} from "../../api/client"
import {
  calculateDistanceKm,
  calculatePrice,
  isWithinUkraineServiceArea,
  ON_SITE_DESTINATION_LABEL,
  sanitizeLocation,
  serviceRequiresDestination,
  validateCustomerOrderInput,
  type CustomerOrderInput,
  type ServiceKey,
} from "../../lib/pomichDomain"
import { getTelegramContext, openTelegramLocationSettings } from "../../telegram"
import {
  isCustomerProfileComplete,
  isCustomerReadyForOrder,
  isCustomerVerified,
  mergeCustomerProfiles,
} from "../../lib/customerProfile"
import {
  PICKUP,
  services,
  orderStatusLabels,
  getServiceLabel,
  type Point,
  type OrderStatus,
  type Screen,
  type GeoState,
} from "../../lib/constants"
import {
  createServiceDetails,
  serviceDetailsComplete,
  summarizeServiceDetails,
  type ServiceDetails,
} from "../../lib/serviceDetails"
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
import { forwardGeocodeAddress, reverseGeocodeAddress } from "../../lib/reverseGeocode"
import { MAP_GEO_DEBOUNCE_MS, MAP_GEO_WATCH_DEBOUNCE_MS, MAP_RECENTER_THRESHOLD_M, canRequestGeoSilently, isTelegramMiniApp, readCachedGeoPosition, readRememberedGeoPermission, requestCurrentPosition, resolveGroundSpeedMps, shouldAcceptGeoUpdate, shouldRecenterMap, smoothSpeedMps, writeCachedGeoPosition, writeRememberedGeoPermission } from "../../lib/mapGeo"
import { syncProfileCityFromGeo } from "../../lib/syncProfileCityFromGeo"
import { OrderErrorStep, OrderFinalStep } from "./OrderTerminalStep"
import { useTelegramMainButton, useTelegramBackButton, useTelegramUx } from "../../hooks/useTelegramUx"
import { normalizeOrderStatus, screenForOrderStatus } from "../../lib/orderStatus"
import { useConfirmDialog } from "../ui/ConfirmDialog"
import { validateUkraineMobilePhone } from "../../lib/ukrainePhone"
import { DEFAULT_SERVICE_CITY, normalizeServiceCity, nearestServiceCity, resolveServiceCityFromGeo } from "../../lib/ukraineCities"
import {
  resolveDisplayedServiceCity,
  writeCityUserPicked,
  writePreferredCity,
} from "../../lib/preferredCity"
import { subscribeOrderEvents } from "../../lib/realtime"
import { resolveServiceDestination, resolveOrderDistanceKm } from "./customerFlowUi"
import HomeStep from "./steps/HomeStep"
import LocationStep from "./steps/LocationStep"
import DestinationStep from "./steps/DestinationStep"
import DetailsStep from "./steps/DetailsStep"
import ReviewStep from "./steps/ReviewStep"
import SearchingStep from "./steps/SearchingStep"
import AcceptedStep from "./steps/AcceptedStep"
import AssignedStep from "./steps/AssignedStep"
import TrackingStep from "./steps/TrackingStep"
import ArrivedStep from "./steps/ArrivedStep"
import InProgressStep from "./steps/InProgressStep"

export default function CustomerFlow({ onLogout }: { onLogout?: () => void } = {}) {
  const confirm = useConfirmDialog()
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
  const [destinationResolved, setDestinationResolved] = useState(false)
  const [serviceDetails, setServiceDetails] = useState<ServiceDetails>(() => createServiceDetails("tow"))
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
  const [geoState, setGeoState] = useState<GeoState>(() => {
    if (typeof window === "undefined") return "requesting"
    if (readCachedGeoPosition()) return "success"
    if (readRememberedGeoPermission() === "denied") return "permission-denied"
    // No sticky grant and no cache — wait for «Оновити»; do not auto-prompt the OS.
    if (readRememberedGeoPermission() === "granted") return "requesting"
    return "unavailable"
  })
  const [geoMessage, setGeoMessage] = useState(() => {
    if (typeof window === "undefined") return "Визначаємо ваше місцезнаходження…"
    if (readCachedGeoPosition()) return "Місцезнаходження з попереднього сеансу."
    if (readRememberedGeoPermission() === "denied") {
      return "Доступ до геолокації заборонено. Натисніть «Оновити», щоб дозволити знову."
    }
    if (readRememberedGeoPermission() === "granted") {
      return "Визначаємо ваше місцезнаходження…"
    }
    return "Натисніть «Оновити», щоб дозволити геолокацію."
  })
  const [addressLabel, setAddressLabel] = useState("Визначаємо адресу…")
  const [geoRecenterTrigger, setGeoRecenterTrigger] = useState(0)
  const [geoSpeedMps, setGeoSpeedMps] = useState<number | null>(null)
  const [pickup, setPickup] = useState<Point>(() => readCachedGeoPosition() ?? PICKUP)
  const explicitGeoRecenterRef = useRef(false)
  const skipNextAutoGeoRef = useRef(false)
  /** True while an explicit «Оновити» request is in flight — blocks StrictMode auto re-entry. */
  const explicitGeoInFlightRef = useRef(false)
  /** Bumped on each geo request so stale auto callbacks cannot overwrite «Оновити». */
  const geoRequestGenRef = useRef(0)
  const pickupRef = useRef<Point>(readCachedGeoPosition() ?? PICKUP)
  const geoWatchDebounceRef = useRef<number | undefined>(undefined)
  const geoMotionSampleRef = useRef<{ point: Point; at: number } | null>(null)
  const geoSpeedSmoothRef = useRef<number | null>(null)
  const lastGeocodedPickupRef = useRef<Point | null>(null)
  const lastCitySyncPickupRef = useRef<Point | null>(null)
  const [destinationPoint, setDestinationPoint] = useState<Point>(PICKUP)
  const [liveNearbyProviders, setLiveNearbyProviders] = useState<ProviderAvailability[]>([])
  const [liveNearbyLoading, setLiveNearbyLoading] = useState(false)
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

  const serviceCity = useMemo(
    () =>
      resolveDisplayedServiceCity({
        profileCity: customerProfile.city,
        pickup,
      }),
    [customerProfile.city, pickup.lat, pickup.lng],
  )

  // A 0.001° cell is roughly 75–111 m in Ukraine/central Europe. Nearby providers
  // use a 35 km radius, so re-querying for every 2–10 m GPS wobble adds traffic but
  // cannot materially change the result.
  const nearbyQueryLat = Math.round(pickup.lat * 1000) / 1000
  const nearbyQueryLng = Math.round(pickup.lng * 1000) / 1000

  const applyServiceCity = useCallback(
    (nextCity: string) => {
      const normalized = normalizeServiceCity(nextCity)
      writePreferredCity(normalized)
      writeCityUserPicked(true)
      if (normalized === serviceCity) return
      setCustomerProfile((profile) => ({ ...profile, city: normalized }))
      /* Keep real GPS pickup — only change the service-city preference. */
      setGeoMessage(`Місто сервісу: ${normalized}`)
      if (customerId && customerAuthToken) {
        updateCustomerProfile(customerId, { city: normalized }, customerAuthToken).catch(() => undefined)
      }
    },
    [serviceCity, customerId, customerAuthToken],
  )

  useEffect(() => {
    if (screen !== "home") return
    let cancelled = false
    setLiveNearbyLoading(true)
    getMapProviders({
      lat: nearbyQueryLat,
      lng: nearbyQueryLng,
      radiusKm: 35,
      kind: "dispatch",
      status: "online",
      verificationStatus: "verified",
    })
      .then((items) => {
        if (cancelled) return
        setLiveNearbyProviders(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (!cancelled) setLiveNearbyProviders([])
      })
      .finally(() => {
        if (!cancelled) setLiveNearbyLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [screen, nearbyQueryLat, nearbyQueryLng])

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
        const point = { lat: session.location.latitude, lng: session.location.longitude }
        writeCachedGeoPosition(point)
        // Session coords are not an OS browser geolocation grant — do not sticky-grant
        // or Safari/Chrome watchPosition may fail silently while HUD stuck at "0"/"—".
        setPickup(point)
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

    const previous = lastGeocodedPickupRef.current
    if (previous && !shouldRecenterMap(previous, pickup, MAP_RECENTER_THRESHOLD_M)) return

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      reverseGeocodeAddress(pickup).then((label) => {
        if (cancelled) return
        lastGeocodedPickupRef.current = pickup
        const looksLikeCoords = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(label)
        if (looksLikeCoords) {
          const nearest = nearestServiceCity(pickup)
          setAddressLabel(nearest ? `${label} · біля ${nearest.city}` : label)
          return
        }
        setAddressLabel(label)
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

    const previous = lastCitySyncPickupRef.current
    if (previous && !shouldRecenterMap(previous, pickup, MAP_RECENTER_THRESHOLD_M)) return

    let cancelled = false
    lastCitySyncPickupRef.current = pickup
    syncProfileCityFromGeo(pickup, customerId, customerAuthToken, customerProfile.city)
      .then((result) => {
        if (cancelled || !result) return
        if (typeof window !== "undefined") {
          writePreferredCity(result.city)
        }
        setCustomerProfile((profile) => {
          const targetCity = result.saved?.city || result.city
          const resolvedTarget = resolveServiceCityFromGeo(pickup, targetCity) || result.city
          if (
            profile.city === resolvedTarget &&
            (!result.saved || profile.verificationStatus === result.saved.verificationStatus)
          ) {
            return profile
          }
          const next = result.saved
            ? mergeCustomerProfiles(profile, { ...result.saved, city: resolvedTarget })
            : { ...profile, city: resolvedTarget }
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
    if (explicitGeoInFlightRef.current) return
    if (skipNextAutoGeoRef.current) {
      skipNextAutoGeoRef.current = false
      return
    }

    let cancelled = false
    const requestGen = geoRequestGenRef.current
    requestCurrentPosition(
      (nextPoint) => {
        if (cancelled || requestGen !== geoRequestGenRef.current) return
        setPickup(nextPoint)
        setGeoState("success")
        setGeoMessage("Місцезнаходження визначено.")
        if (explicitGeoRecenterRef.current) {
          explicitGeoRecenterRef.current = false
          setGeoRecenterTrigger((value) => value + 1)
        }
      },
      (message, kind) => {
        if (cancelled || requestGen !== geoRequestGenRef.current) return
        setGeoState(kind === "permission-denied" ? "permission-denied" : "unavailable")
        setGeoMessage(message)
      },
      { mode: "auto" },
    )

    return () => {
      cancelled = true
    }
  }, [geoState, screen])

  // Reopen with cached coords: quiet refresh only when OS permission is already granted.
  useEffect(() => {
    if (geoState !== "success") return
    let cancelled = false
    const requestGen = geoRequestGenRef.current
    void canRequestGeoSilently().then((ok) => {
      if (cancelled || !ok) return
      requestCurrentPosition(
        (nextPoint) => {
          if (cancelled || requestGen !== geoRequestGenRef.current) return
          setPickup(nextPoint)
        },
        () => undefined,
        { mode: "auto" },
      )
    })
    return () => {
      cancelled = true
    }
    // Intentionally once when we first become successful (incl. cache restore).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const mapScreens: Screen[] = ["home", "location", "destination"]
    if (!mapScreens.includes(screen)) return
    // Live watch after browser success, or Telegram Mini App session pin (WebView GPS).
    // Deny in Mini App must not sticky-wipe the session pin.
    if (geoState !== "success" && !(geoState === "telegram" && isTelegramMiniApp())) return
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return
    if (typeof navigator.geolocation.watchPosition !== "function") return

    let cancelled = false
    let watchId: number | undefined
    let denied = false

    const applyGeoPosition = (position: GeolocationPosition) => {
      const nextPoint = { lat: position.coords.latitude, lng: position.coords.longitude }
      const rawSpeed = resolveGroundSpeedMps(position, geoMotionSampleRef.current)
      const smoothed = smoothSpeedMps(geoSpeedSmoothRef.current, rawSpeed)
      geoSpeedSmoothRef.current = smoothed
      setGeoSpeedMps(smoothed)
      geoMotionSampleRef.current = {
        point: nextPoint,
        at: typeof position.timestamp === "number" ? position.timestamp : Date.now(),
      }
      if (!shouldAcceptGeoUpdate(pickupRef.current, nextPoint, position.coords.accuracy)) return
      writeCachedGeoPosition(nextPoint)
      // Navigator-style updates, with only sub-accuracy stationary jitter filtered above.
      pickupRef.current = nextPoint
      setPickup(nextPoint)
      if (isTelegramMiniApp()) writeRememberedGeoPermission("granted")
      setGeoState((current) => (current === "telegram" ? "success" : current))
    }

    const startWatch = () => {
      if (cancelled || denied || typeof watchId === "number") return
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          if (denied) return
          window.clearTimeout(geoWatchDebounceRef.current)
          geoWatchDebounceRef.current = window.setTimeout(() => {
            applyGeoPosition(position)
          }, MAP_GEO_WATCH_DEBOUNCE_MS)
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            denied = true
            setGeoSpeedMps(null)
            geoSpeedSmoothRef.current = null
            if (typeof watchId === "number") {
              navigator.geolocation.clearWatch(watchId)
              watchId = undefined
            }
            // Telegram Mini App: LM/session pin must survive a WebView geolocation deny.
            if (!isTelegramMiniApp()) {
              writeRememberedGeoPermission("denied")
              setGeoState("permission-denied")
              setGeoMessage(
                "Дозвольте доступ до геолокації в браузері або Telegram, потім натисніть «Оновити».",
              )
            }
            return
          }
          // Transient timeout / unavailable — keep last point; clear speed so HUD shows "—".
          setGeoSpeedMps(null)
          geoSpeedSmoothRef.current = null
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
      )
    }

    // watchPosition also triggers the OS geolocation prompt — never start it
    // just because we are inside Telegram Mini App without a silent browser grant.
    void canRequestGeoSilently().then((ok) => {
      if (cancelled || !ok) return
      startWatch()
    })

    return () => {
      cancelled = true
      window.clearTimeout(geoWatchDebounceRef.current)
      if (typeof watchId === "number") navigator.geolocation.clearWatch(watchId)
      setGeoSpeedMps(null)
      geoSpeedSmoothRef.current = null
      geoMotionSampleRef.current = null
    }
  }, [screen, geoState])

  const retryGeolocation = () => {
    explicitGeoRecenterRef.current = true
    skipNextAutoGeoRef.current = true
    explicitGeoInFlightRef.current = true
    geoRequestGenRef.current += 1
    const requestGen = geoRequestGenRef.current
    /* Keep intentional city pick — locate only refreshes GPS/address. */
    setGeoState("requesting")
    setGeoMessage("Визначаємо ваше місцезнаходження…")
    setAddressLabel("Визначаємо адресу…")
    // Safety: never leave the button stuck on «Оновлюємо…» if the OS never answers.
    window.setTimeout(() => {
      if (requestGen !== geoRequestGenRef.current) return
      if (!explicitGeoInFlightRef.current) return
      explicitGeoInFlightRef.current = false
      setGeoState((current) => (current === "requesting" ? "unavailable" : current))
      setGeoMessage("Не вдалося визначити місцезнаходження вчасно. Натисніть «Оновити» ще раз або оберіть точку на карті.")
    }, 20_000)
    // Call from the click gesture so iOS Safari / Telegram can show the permission prompt.
    requestCurrentPosition(
      (nextPoint) => {
        if (requestGen !== geoRequestGenRef.current) return
        explicitGeoInFlightRef.current = false
        setPickup(nextPoint)
        setGeoState("success")
        setGeoMessage("Місцезнаходження визначено.")
        if (explicitGeoRecenterRef.current) {
          explicitGeoRecenterRef.current = false
          setGeoRecenterTrigger((value) => value + 1)
        }
      },
      (message, kind) => {
        if (requestGen !== geoRequestGenRef.current) return
        explicitGeoInFlightRef.current = false
        setGeoState(kind === "permission-denied" ? "permission-denied" : "unavailable")
        setGeoMessage(message)
      },
      { mode: "explicit" },
    )
  }

  const openGeoSettings = () => {
    const opened = openTelegramLocationSettings(telegramContext.webApp)
    if (!opened) {
      setGeoMessage(
        "Увімкніть геолокацію в налаштуваннях телефону / браузера для pomich.help, потім натисніть «Оновити».",
      )
      setGeoState("permission-denied")
    }
  }

  const geoLoading = geoState === "requesting"
  const geoError = geoState === "permission-denied"
    ? (geoMessage || "Дозвольте доступ до геолокації в браузері або Telegram, потім натисніть «Оновити».")
    : geoState === "unavailable"
      ? (geoMessage || "Не вдалося визначити геолокацію. Натисніть «Оновити» або оберіть точку на карті.")
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
          if (current !== "home" && orderId) return current
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
    // Do not write manual map picks into the shared GPS cache — that poisoned
    // partner/landing reopen with a dragged customer pin.
    setGeoState("success")
    setGeoMessage(message)
  }

  const confirmPickupLocation = () => {
    if (!isWithinUkraineServiceArea(pickup)) return
    if (serviceRequiresDestination(selectedService)) {
      // Keep map centered on the client until they pick a real destination.
      setDestination("")
      setDestinationResolved(false)
      setDestinationPoint(pickup)
      setScreen("destination")
      return
    }
    const onSite = resolveServiceDestination(selectedService, pickup)
    setDestination(onSite.destination)
    setDestinationResolved(true)
    setDestinationPoint(onSite.destinationPoint)
    setScreen("details")
  }

  const applyOnSiteDestination = () => {
    const onSite = resolveServiceDestination(selectedService, pickup)
    setDestination(onSite.destination)
    setDestinationResolved(true)
    setDestinationPoint(onSite.destinationPoint)
    setScreen("details")
  }

  const setDestinationFromMap = (point: Point) => {
    setDestinationPoint(point)
    setDestination(`Точка на карті ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`)
    setDestinationResolved(true)
  }

  const setDestinationFromAddress = (point: Point, label: string) => {
    setDestinationPoint(point)
    setDestination(label)
    setDestinationResolved(true)
  }

  const submitOrder = async () => {
    if (loading) return
    if (!serviceDetailsComplete(serviceDetails)) {
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
        serviceDetails,
        vehicleState: summarizeServiceDetails(serviceDetails),
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
    const confirmed = await confirm({
      title: "Скасувати заявку?",
      description: "Партнер отримає сповіщення про скасування.",
      confirmLabel: "Скасувати заявку",
      cancelLabel: "Залишити заявку",
      danger: true,
    })
    if (!confirmed) return
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
    const phone = currentOrder?.assignedProvider?.phone
    const telegram = currentOrder?.assignedProvider?.telegram
    if (phone) {
      window.location.href = `tel:${phone}`
      return
    }
    if (telegram) {
      window.location.href = `https://t.me/${telegram.replace(/^@/, "")}`
    }
  }

  const confirmProposedPrice = async () => {
    if (!orderId || priceConfirming) return
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
    setSelectedService("tow")
    setServiceDetails(createServiceDetails("tow"))
    setCustomerComment("")
    setDestination("")
    setDestinationResolved(false)
    clearActiveOrder()
  }, [])

  const submitCustomerOrderReview = useCallback(async ({ rating, comment }: { rating: number; comment: string }) => {
    if (!orderId || customerReviewSaving) return
    if (currentOrder?.customerReview?.rating) {
      setCustomerReviewSubmitted(true)
      return
    }
    setCustomerReviewSaving(true)
    setCustomerReviewError(undefined)
    const markDone = (order?: typeof currentOrder) => {
      if (order) setCurrentOrder(order)
      setCustomerReviewSubmitted(true)
      setCustomerReviewError(undefined)
    }
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
      markDone(updated)
    } catch (err) {
      try {
        const refreshed = await getOrder(orderId, customerAuthToken)
        if (refreshed?.customerReview?.rating) {
          markDone(refreshed)
          return
        }
      } catch {
        /* ignore */
      }
      const message = messageFromFetchError(err, "Не вдалося зберегти оцінку. Спробуйте ще раз.")
      // Idempotent: review already saved — treat as success and unlock continue/logout flow.
      if (message.includes("already") || message.includes("вже") || /REVIEW_ALREADY/i.test(String(err))) {
        try {
          const refreshed = await getOrder(orderId, customerAuthToken)
          markDone(refreshed)
        } catch {
          markDone()
        }
      } else {
        setCustomerReviewError(message)
      }
    } finally {
      setCustomerReviewSaving(false)
    }
  }, [orderId, customerId, customerAuthToken, currentOrder?.customerId, currentOrder?.customerReview?.rating, customerReviewSaving])

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
          if (destinationResolved) setScreen("details")
        } else {
          applyOnSiteDestination()
        }
        break
      case "details":
        haptic("medium")
        if (serviceDetailsComplete(serviceDetails)) setScreen("review")
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
  }, [screen, haptic, verifyCustomerProfile, confirmPickupLocation, applyOnSiteDestination, destinationResolved, selectedService, serviceDetails, submitOrder, startTracking, restart, customerReviewSubmitted, currentOrder?.customerReview?.rating])

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
    screen === "location" ? isWithinUkraineServiceArea(pickup) :
    screen === "destination" ? (serviceRequiresDestination(selectedService) ? destinationResolved : true) :
    screen === "details" ? serviceDetailsComplete(serviceDetails) :
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
    visible: isTelegram && ["location", "destination", "details", "review"].includes(screen),
    onClick: goBackScreen,
  })

  const screenContent = (() => {
  switch (screen) {
    case "location":
      return (
        <LocationStep
          pickup={pickup}
          serviceKey={selectedService}
          addressLabel={addressLabel}
          geoMessage={geoMessage}
          geoLoading={geoLoading}
          geoError={geoError}
          recenterTrigger={geoRecenterTrigger}
          geoSpeedMps={geoSpeedMps}
          isTelegram={isTelegram}
          onPick={(point) => applyPickup(point)}
          onRetryGeo={retryGeolocation}
          onBack={() => setScreen("home")}
          onNext={confirmPickupLocation}
        />
      )
    case "destination":
      return (
        <DestinationStep
          pickup={pickup}
          destination={destinationPoint}
          value={destination}
          serviceKey={selectedService}
          geoSpeedMps={geoSpeedMps}
          isTelegram={isTelegram}
          onPick={setDestinationFromMap}
          onResolvedAddress={setDestinationFromAddress}
          onChange={(value) => { setDestination(value); setDestinationResolved(false) }}
          destinationResolved={destinationResolved}
          onBack={() => setScreen("location")}
          onNext={() => setScreen("details")}
          onSkipOnSite={applyOnSiteDestination}
        />
      )
    case "details":
      return <DetailsStep pickup={pickup} destination={destinationPoint} details={serviceDetails} isTelegram={isTelegram} onChange={setServiceDetails} onBack={() => setScreen(serviceRequiresDestination(selectedService) ? "destination" : "location")} onNext={() => setScreen("review")} />
    case "review":
      return (
        <ReviewStep
          serviceLabel={serviceLabel}
          serviceKey={selectedService}
          addressLabel={addressLabel}
          destination={destination}
          pickup={pickup}
          destinationPoint={destinationPoint}
          serviceDetails={serviceDetails}
          customerComment={customerComment}
          onCustomerCommentChange={setCustomerComment}
          loading={loading}
          isTelegram={isTelegram}
          onConfirm={submitOrder}
          onBack={() => setScreen("details")}
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
          showAction={!isTelegram}
          reviewMode="customer"
          reviewSaving={customerReviewSaving}
          reviewError={customerReviewError}
          reviewSubmitted={customerReviewDone}
          onSubmitReview={submitCustomerOrderReview}
        />
      )
    case "cancelled":
      return <OrderFinalStep orderId={orderId} status="cancelled" pickup={pickup} destination={destinationPoint} onRestart={restart} showAction={!isTelegram} />
    case "error":
      return <OrderErrorStep pickup={pickup} destination={destinationPoint} onRetry={() => setScreen("review")} showAction={!isTelegram} />
    case "home":
    default:
      return <HomeStep pickup={pickup} locationLabel={addressLabel || geoMessage} serviceCity={serviceCity} providers={liveNearbyProviders} providersLoading={liveNearbyLoading} customerProfile={customerProfile} customerVerificationSaving={customerVerificationSaving} customerVerificationError={customerVerificationError} customerToken={customerAuthToken} isTelegram={isTelegram} geoLoading={geoLoading} geoError={geoError} recenterTrigger={geoRecenterTrigger} geoSpeedMps={geoSpeedMps} onProfileChange={(patch) => setCustomerProfile((profile) => ({ ...profile, ...patch }))} onVerifyCustomer={verifyCustomerProfile} onProfileVerified={(saved) => setCustomerProfile((profile) => ({ ...profile, ...saved }))} onRetryGeo={retryGeolocation} onOpenGeoSettings={openGeoSettings} onServiceCityChange={applyServiceCity} onSelect={(service) => { if (!isCustomerReadyForOrder(customerProfile)) return; setSelectedService(service); setServiceDetails(createServiceDetails(service)); setCustomerComment(""); setDestination(""); setDestinationResolved(false); setDestinationPoint(pickup); setScreen("location") }} />
  }
  })()

  return screenContent
}
