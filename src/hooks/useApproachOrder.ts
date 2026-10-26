import { useEffect, useRef, useState } from "react"
import type { OrderResponse } from "../api/client"
import { fetchOsrmRoute } from "../lib/osrmRoute"
import { providerLocationFresh } from "../lib/orderReliability"

/** Route requests are bounded to one per minute or ~100m cell; polling does not refetch. */
export default function useApproachOrder(order?: OrderResponse) {
  const [now, setNow] = useState(Date.now())
  const [route, setRoute] = useState<{ key: string; minutes: number; distanceKm: number; at: number }>()
  const previousArrival = useRef<number | undefined>(undefined)
  const [delay, setDelay] = useState(false)
  const from = order?.assignedProvider?.location
  const to = order?.customerCoordinates
  const fresh = providerLocationFresh(order, now)
  const active = ["accepted", "price_confirmed", "assigned", "en_route"].includes(order?.status || "")
  const cell = (value?: number) => value === undefined ? "" : Math.round(value * 1000)
  const key = `${order?.id}:${order?.assignedProvider?.id}:${cell(from?.lat)},${cell(from?.lng)}:${to?.lat},${to?.lng}`
  const minute = Math.floor(now / 60000)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    setDelay(false)
    setRoute(undefined)
    previousArrival.current = undefined
  }, [order?.id, order?.assignedProvider?.id])
  useEffect(() => {
    if (!active || !fresh || !from || !to) return
    let cancelled = false
    void fetchOsrmRoute(from, to).then(result => {
      if (cancelled || !result || !Number.isFinite(result.durationSeconds) || result.durationSeconds < 0) return
      const minutes = Math.max(1, Math.ceil(result.durationSeconds / 60))
      const at = Date.now()
      const arrival = at + minutes * 60000
      if (previousArrival.current !== undefined && arrival > previousArrival.current + 5 * 60000) setDelay(true)
      previousArrival.current = arrival
      setRoute({ key, minutes, distanceKm: result.distanceMeters / 1000, at })
    })
    return () => { cancelled = true }
    // GPS jitter within a cell and order polling must not multiply routing requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, minute, active, fresh])
  const usableRoute = route?.key === key && now - route.at <= 90000 ? route : undefined
  const displayOrder = order?.assignedProvider && active ? {
    ...order,
    assignedProvider: {
      ...order.assignedProvider,
      etaMinutes: fresh ? usableRoute?.minutes : undefined,
      etaSource: "osrm" as const,
      distanceKm: fresh ? usableRoute?.distanceKm ?? order.assignedProvider.distanceKm : undefined,
    },
  } : order
  return { displayOrder, fresh, delayed: delay && fresh && Boolean(usableRoute), now }
}
