import { useEffect, useState } from "react"
import { getMapProviders, type ProviderAvailability } from "../../../api/client"
import type { Point, Screen } from "../../../lib/constants"

export default function useCustomerNearbyProviders(
  screen: Screen,
  pickup: Point,
) {
  const [liveNearbyProviders, setLiveNearbyProviders] =
    useState<ProviderAvailability[]>([])
  const [liveNearbyLoading, setLiveNearbyLoading] = useState(false)

  // A 0.001° cell is roughly 75–111 m in Ukraine/central Europe. Nearby providers
  // use a 35 km radius, so re-querying for every 2–10 m GPS wobble adds traffic but
  // cannot materially change the result.
  const nearbyQueryLat = Math.round(pickup.lat * 1000) / 1000
  const nearbyQueryLng = Math.round(pickup.lng * 1000) / 1000

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

  return { liveNearbyProviders, liveNearbyLoading }
}
