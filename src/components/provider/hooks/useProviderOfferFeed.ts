import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react"
import {
  getProviderOffers,
  getNearbyMapOrders,
  type DispatchOffer,
  type MapRequestPin,
  type OrderResponse,
} from "../../../api/client"
import { readAuthSessionSubject } from "../../../lib/auth"
import { services, getServiceEmoji, type Point } from "../../../lib/constants"
import type { ServiceKey } from "../../../lib/pomichDomain"
import type { getTelegramContext } from "../../../telegram"
import {
  filterActiveMapRequestPins,
  filterActiveOffers,
  filterVisibleOffers,
  mergeRequestPins,
} from "../../../lib/dispatchOffer"
import { subscribeProviderEvents } from "../../../lib/realtime"
import {
  alertPartnerNewRequest,
  diffNewIds,
  ensurePartnerAlertPermission,
} from "../../../lib/partnerDutyAlerts"

interface Options {
  activeOrder?: OrderResponse
  onDuty: boolean
  providerAuthToken?: string
  providerId: string
  step: string
  radiusKm: number
  providerSpecialties: ServiceKey[]
  providerLocationRef: RefObject<Point>
  dismissedOfferIdsRef: RefObject<Set<string>>
  dismissedOrderIdsRef: RefObject<Set<string>>
  setOfferError: Dispatch<SetStateAction<string | undefined>>
  webApp: ReturnType<typeof getTelegramContext>["webApp"]
}

/** Owns polling, realtime refresh, expiry filtering, map pins and request alerts. */
export default function useProviderOfferFeed({
  activeOrder,
  onDuty,
  providerAuthToken,
  providerId,
  step,
  radiusKm,
  providerSpecialties,
  providerLocationRef,
  dismissedOfferIdsRef,
  dismissedOrderIdsRef,
  setOfferError,
  webApp,
}: Options) {
  const [incomingOffers, setIncomingOffers] = useState<DispatchOffer[]>([])
  const [nearbyRequestPins, setNearbyRequestPins] = useState<MapRequestPin[]>(
    [],
  )
  const [mapRequestPins, setMapRequestPins] = useState<MapRequestPin[]>([])
  const [offerClock, setOfferClock] = useState(Date.now())
  const seenDutyAlertIdsRef = useRef<Set<string>>(new Set())
  const dutyAlertsSeededRef = useRef(false)
  // Stable contents prevent a fresh array on each controller render from restarting polling.
  const specialtyKey = providerSpecialties.join(",")

  useEffect(() => {
    const interval = window.setInterval(() => setOfferClock(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (
      !onDuty ||
      !providerAuthToken ||
      activeOrder ||
      (step !== "duty" && step !== "offer")
    )
      return
    let cancelled = false
    const subjectId = readAuthSessionSubject(providerAuthToken) || providerId

    const refreshOffers = () => {
      // Poll while backgrounded so we can fire local notifications; Telegram bot
      // messages still cover fully suspended Mini Apps (esp. iOS).
      getProviderOffers(subjectId, providerAuthToken)
        .then((offers) => {
          if (!cancelled) {
            const activeOffers = filterVisibleOffers(
              Array.isArray(offers) ? offers : [],
              {
                dismissedOfferIds: dismissedOfferIdsRef.current,
                dismissedOrderIds: dismissedOrderIdsRef.current,
              },
            )
            setIncomingOffers((prev) => {
              if (
                prev.length === activeOffers.length &&
                prev.every(
                  (item, i) =>
                    item.id === activeOffers[i]?.id &&
                    item.status === activeOffers[i]?.status,
                )
              ) {
                return prev
              }
              return activeOffers
            })
            if (activeOffers.length > 0) setOfferError(undefined)
          }
        })
        .catch(() => {
          if (!cancelled)
            setIncomingOffers((prev) => (prev.length === 0 ? prev : []))
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
    if (
      !onDuty ||
      !providerAuthToken ||
      activeOrder ||
      (step !== "duty" && step !== "offer")
    ) {
      setNearbyRequestPins((pins) => (pins.length === 0 ? pins : []))
      return
    }
    let cancelled = false

    const refreshNearby = () => {
      const loc = providerLocationRef.current
      getNearbyMapOrders(
        loc.lat,
        loc.lng,
        radiusKm,
        undefined,
        providerAuthToken,
      )
        .then((orders) => {
          if (cancelled) return
          const visible = filterActiveMapRequestPins(
            Array.isArray(orders) ? orders : [],
          ).filter((pin) => {
            if (dismissedOrderIdsRef.current.has(pin.id)) return false
            if (
              pin.service &&
              providerSpecialties.length > 0 &&
              !providerSpecialties.includes(pin.service as ServiceKey)
            ) {
              return false
            }
            return true
          })
          setNearbyRequestPins((prev) => {
            if (
              prev.length === visible.length &&
              prev.every((item, i) => item.id === visible[i]?.id)
            ) {
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
  }, [activeOrder, onDuty, providerAuthToken, radiusKm, specialtyKey, step])

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
      ).map((pin) => {
        // Ensure every active offer is visible on the duty map even if the backend
        // omitted customerCoordinates (sheet still has the full offer details).
        if (pin.customerCoordinates) return pin
        if (!pin.offerId) return pin
        return {
          ...pin,
          customerCoordinates: {
            lat: providerLocationRef.current.lat,
            lng: providerLocationRef.current.lng,
          },
          customerLocation: pin.customerLocation || "Поруч із вами",
        }
      })
      if (
        prev.length === next.length &&
        prev.every(
          (p, i) => p.id === next[i]?.id && p.offerId === next[i]?.offerId,
        )
      ) {
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
      const offer = incomingOffers.find(
        (item) => item.orderId === orderId || item.id === orderId,
      )
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
        distanceLabel:
          typeof distanceKm === "number"
            ? `${distanceKm.toFixed(1)} км`
            : undefined,
        webApp: webApp,
      })
    }
  }, [incomingOffers, nearbyRequestPins, onDuty, webApp])

  useEffect(() => {
    if (!onDuty) return
    // Hydrate-online / restore session: ask once when duty becomes true.
    void ensurePartnerAlertPermission()
  }, [onDuty])

  return {
    incomingOffers,
    setIncomingOffers,
    nearbyRequestPins,
    setNearbyRequestPins,
    mapRequestPins,
    setMapRequestPins,
    offerClock,
    seenDutyAlertIdsRef,
    dutyAlertsSeededRef,
  }
}
