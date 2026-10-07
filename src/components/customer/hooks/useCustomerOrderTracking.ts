import {
  useEffect,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react"
import {
  getCustomerOrders,
  getOrder,
  type OrderResponse,
} from "../../../api/client"
import {
  clearActiveOrder,
  isActiveOrderStatus,
  isTerminalOrderStatus,
  persistActiveOrder,
  pickLatestActiveOrder,
  readActiveOrder,
} from "../../../lib/customerSession"
import {
  normalizeOrderStatus,
  screenForOrderStatus,
} from "../../../lib/orderStatus"
import { subscribeOrderEvents } from "../../../lib/realtime"
import type { Point, Screen, OrderStatus } from "../../../lib/constants"

interface Options {
  customerId: string
  customerAuthToken?: string
  orderId?: string
  screen: Screen
  ensureCustomerSession: () => Promise<{ customerId?: string; token?: string }>
  setOrderId: Dispatch<SetStateAction<string | undefined>>
  setCurrentOrder: Dispatch<SetStateAction<OrderResponse | undefined>>
  setStatus: Dispatch<SetStateAction<OrderStatus>>
  setScreen: Dispatch<SetStateAction<Screen>>
  setPickup: Dispatch<SetStateAction<Point>>
  setDestinationPoint: Dispatch<SetStateAction<Point>>
  userInitiatedCancelRef: RefObject<boolean>
}

/** Restores active orders and owns polling/realtime/focus subscription cleanup. */
export default function useCustomerOrderTracking({
  customerId,
  customerAuthToken,
  orderId,
  screen,
  ensureCustomerSession,
  setOrderId,
  setCurrentOrder,
  setStatus,
  setScreen,
  setPickup,
  setDestinationPoint,
  userInitiatedCancelRef,
}: Options) {
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
        const orders = await getCustomerOrders(
          session.customerId,
          session.token,
          20,
        )
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
                if (snapshot.customerCoordinates)
                  setPickup(snapshot.customerCoordinates)
                if (snapshot.destinationCoordinates)
                  setDestinationPoint(snapshot.destinationCoordinates)
                setScreen((current) => {
                  if (current === "cancelled" || current === "completed")
                    return current
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

        const full =
          orders.find((item) => item.id === active.orderId) ??
          (await getOrder(active.orderId, session.token))
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
        if (full.destinationCoordinates)
          setDestinationPoint(full.destinationCoordinates)
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
        if (
          currentScreen === "tracking" &&
          nextStatus !== "en_route" &&
          nextStatus !== "arrived" &&
          nextStatus !== "in_progress" &&
          nextStatus !== "completed" &&
          nextStatus !== "cancelled"
        ) {
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
}
