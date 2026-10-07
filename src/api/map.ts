import { getBaseUrl, authHeaders } from "./transport"
import type { ProviderAvailability, MapRequestPin, MapSettlement } from "./types"

export async function getMapProviders(options?: {
  scope?: "all" | "city"
  city?: string
  lat?: number
  lng?: number
  radiusKm?: number
  kind?: "dispatch" | "directory"
  /** Comma-separated presence filter, e.g. "online" or "online,busy". */
  status?: string
  verificationStatus?: "verified" | "pending" | "unverified"
  bbox?: [number, number, number, number]
  zoom?: number
  service?: string
}) {
  const params = new URLSearchParams()
  if (options?.scope === "all") params.set("scope", "all")
  if (options?.city) params.set("city", options.city)
  if (options?.lat != null) params.set("lat", String(options.lat))
  if (options?.lng != null) params.set("lng", String(options.lng))
  if (options?.radiusKm != null) params.set("radius_km", String(options.radiusKm))
  if (options?.kind) params.set("kind", options.kind)
  if (options?.status) params.set("status", options.status)
  if (options?.verificationStatus) params.set("verification_status", options.verificationStatus)
  if (options?.bbox) params.set("bbox", options.bbox.join(","))
  if (options?.zoom != null) params.set("zoom", String(Math.round(options.zoom)))
  if (options?.service) params.set("service", options.service)
  const query = params.toString()
  const response = await fetch(`${getBaseUrl()}/map/providers${query ? `?${query}` : ""}`)

  if (!response.ok) {
    throw new Error(`Map providers request failed with ${response.status}`)
  }

  return response.json() as Promise<ProviderAvailability[]>
}

export const SETTLEMENTS_CACHE_KEY = "pomichMapSettlements"

export const SETTLEMENTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export let settlementsMemoryCache: MapSettlement[] | null = null

export let settlementsInflight: Promise<MapSettlement[]> | null = null

export function readSettlementsCache(): MapSettlement[] | null {
  if (settlementsMemoryCache) return settlementsMemoryCache
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(SETTLEMENTS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { ts?: number; items?: MapSettlement[] }
    if (!parsed.ts || !Array.isArray(parsed.items)) return null
    if (Date.now() - parsed.ts > SETTLEMENTS_CACHE_TTL_MS) return null
    settlementsMemoryCache = parsed.items
    return parsed.items
  } catch {
    return null
  }
}

export function writeSettlementsCache(items: MapSettlement[]): void {
  settlementsMemoryCache = items
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(
      SETTLEMENTS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), items }),
    )
  } catch {
    // Ignore quota errors — in-memory cache still helps within the session.
  }
}

export async function getMapSettlements() {
  const cached = readSettlementsCache()
  if (cached) return cached
  if (settlementsInflight) return settlementsInflight

  settlementsInflight = (async () => {
    const response = await fetch(`${getBaseUrl()}/map/settlements`)
    if (!response.ok) {
      throw new Error(`Map settlements request failed with ${response.status}`)
    }
    const items = (await response.json()) as MapSettlement[]
    writeSettlementsCache(Array.isArray(items) ? items : [])
    return Array.isArray(items) ? items : []
  })()

  try {
    return await settlementsInflight
  } finally {
    settlementsInflight = null
  }
}

export async function getNearestMapSettlement(lat: number, lng: number, maxKm = 80) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    max_km: String(maxKm),
  })
  const response = await fetch(`${getBaseUrl()}/map/settlements/nearest?${params.toString()}`)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Nearest settlement request failed with ${response.status}`)
  }

  return response.json() as Promise<
    Partial<MapSettlement> & {
      distanceKm?: number
      fallback?: "radius"
      radiusKm?: number
      code?: string
      message?: string
    }
  >
}

export async function getNearbyMapOrders(
  lat: number,
  lng: number,
  radiusKm = 20,
  service?: string,
  providerToken?: string,
) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(radiusKm),
  })
  if (service) params.set('service', service)

  const response = await fetch(`${getBaseUrl()}/map/orders/nearby?${params.toString()}`, {
    headers: authHeaders(providerToken) ?? {},
  })

  if (!response.ok) {
    throw new Error(`Nearby map orders request failed with ${response.status}`)
  }

  return response.json() as Promise<MapRequestPin[]>
}
